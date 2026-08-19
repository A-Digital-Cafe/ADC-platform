import type { FastifyRequest } from "fastify";
import type { UIModuleConfig } from "../../../../interfaces/modules/IUIModule.js";
import type { StaticAccessGuard } from "../../../../interfaces/modules/providers/IHttpServer.js";
import type { ISessionVerifier } from "@common/types/identity/SessionVerifier.ts";
import type { ILogger } from "../../../../interfaces/utils/ILogger.js";
import { accessAllowsRoles, normalizeAccessRoles, roleKey } from "@common/utils/ui-access.ts";
import { ERROR_APP_DEVPORT, ERROR_APP_PROD_HOST, errorAppPath } from "@common/utils/error-app.ts";
import { isRealProduction } from "@common/utils/runtime-env.ts";
import { isPrivateHost } from "@common/utils/url-utils.ts";

/** Por qué se rechazó, para que la página de error ofrezca la acción correcta. */
type DenyReason = "auth" | "role" | "org" | "unavailable";

/**
 * Vida de una decisión cacheada. Una carga de página pide decenas de assets del mismo host, y
 * sin esto cada uno costaría una verificación de token + una consulta de roles a identity.
 *
 * Corto a propósito: es la ventana en la que un cambio de rol tarda en cortar el acceso a las
 * PÁGINAS. La API no la usa —cada endpoint reautoriza por su cuenta—, así que revocar un rol
 * sigue surtiendo efecto inmediato sobre los datos.
 */
const DECISION_TTL_MS = 10_000;

interface GuardDeps {
	/** Nombre del módulo: es el que ve el usuario en la página de error. */
	moduleName: string;
	/** Etiqueta para el log cuando el gate no cubre el módulo entero (ej. un expose federado). */
	logLabel?: string;
	uiConfig: UIModuleConfig;
	getSessionVerifier: () => ISessionVerifier | null;
	logger: ILogger;
}

/** Protocolo de la request, respetando el edge (`X-Forwarded-Proto`) igual que el robots.txt. */
function requestProtocol(req: FastifyRequest): string {
	const forwarded = req.headers["x-forwarded-proto"];
	const fromEdge = typeof forwarded === "string" ? forwarded.split(",")[0].trim() : "";
	return fromEdge || (isRealProduction() ? "https" : "http");
}

/**
 * URL absoluta de la página de error, resuelta desde el host de la REQUEST y no desde el del
 * kernel: en dev y en LAN se entra por `localhost`, por `192.168.x.y` o por un `*.local.com`, y
 * mandar a un origen distinto del que el usuario está usando pierde la cookie de sesión.
 */
function errorAppUrl(req: FastifyRequest, path: string): string {
	const host = (req.headers.host?.split(",")[0]?.trim() || "").replace(/:\d+$/, "");
	if (!isRealProduction() && (isPrivateHost(host) || host.endsWith(".local.com"))) {
		return `http://${host}:${ERROR_APP_DEVPORT}${path}`;
	}
	return `${requestProtocol(req)}://${ERROR_APP_PROD_HOST}${path}`;
}

function denyUrl(req: FastifyRequest, moduleName: string, reason: DenyReason): string {
	const from = `${requestProtocol(req)}://${req.headers.host ?? ""}${req.url}`;
	return errorAppUrl(req, errorAppPath("/unauthorized", { app: moduleName, reason, from }));
}

/** Token de sesión de la request: cookie primero, `Authorization: Bearer` después. */
function extractToken(req: FastifyRequest, verifier: ISessionVerifier): string | null {
	const cookieToken = verifier.extractSessionToken(req as any);
	if (cookieToken) return cookieToken;
	const authHeader = req.headers.authorization;
	return authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
}

/**
 * Margen antes de consultar el catálogo de roles. El gate se arma durante el arranque, cuando
 * identity puede estar todavía sembrando sus roles predefinidos; preguntar en ese momento daría
 * un catálogo a medias y avisos falsos.
 */
const ROLE_CHECK_DELAY_MS = 15_000;

/**
 * Avisa si un `config.json` nombra un rol que no existe.
 *
 * Es el error más probable de todo esto: con permisos, un scope mal escrito no resolvía y se
 * veía; con roles por nombre, un `"Aplication Manager"` deja el panel cerrado para TODOS y no
 * hay ningún síntoma salvo "dejó de andar".
 *
 * Sólo avisa, nunca falla: los roles viven en la base y uno propio puede crearse después del
 * arranque, así que un nombre ausente es sospechoso, no ilegal. Un catálogo vacío significa
 * "no se pudo consultar" y no dispara nada.
 */
function warnOnUnknownRoles(moduleName: string, declared: readonly string[], getSessionVerifier: () => ISessionVerifier | null, logger: ILogger): void {
	if (declared.length === 0) return;

	const timer = setTimeout(() => {
		void (async () => {
			try {
				const catalog = await getSessionVerifier()?.listRoleNames();
				if (!catalog?.length) return;
				const known = new Set(catalog.map(roleKey));
				const unknown = declared.filter((name) => !known.has(roleKey(name)));
				if (unknown.length === 0) return;
				logger.logWarn(
					`[access] ${moduleName}: ${unknown.map((name) => `"${name}"`).join(", ")} no existe(n) como rol. ` +
						`Nadie va a entrar por ese nombre; revisá la escritura en su config.json.`
				);
			} catch {
				/* validación best-effort: no vale la pena ruido si el catálogo no se pudo leer */
			}
		})();
	}, ROLE_CHECK_DELAY_MS);
	// El chequeo no debe sostener el proceso vivo ni demorar un apagado.
	timer.unref?.();
}

/**
 * Construye el gate de `uiModule.access`, o `undefined` si el módulo no declaró ninguno (el
 * caso normal: casi todas las apps son públicas y no pagan nada por esto).
 */
export function buildAccessGuard({ moduleName, logLabel, uiConfig, getSessionVerifier, logger }: GuardDeps): StaticAccessGuard | undefined {
	const label = logLabel ?? moduleName;
	const access = uiConfig.access;
	// `globalOnly` solo también arma gate: "esto es de plataforma" ya es una restricción, y
	// tratarlo como "no declaró nada" dejaría el módulo abierto justo por pedir menos.
	if (!access?.requireAuth && !access?.roles?.length && access?.globalOnly !== true) return undefined;

	const required = normalizeAccessRoles(access.roles ?? []);
	const globalOnly = access.globalOnly === true;
	const shown = required.length > 0 ? (access.roles ?? []).join(" | ") : "sesión válida";
	logger.logInfo(`[access] ${label} protegido: ${shown}${globalOnly ? " (sólo contexto global)" : ""}`);
	warnOnUnknownRoles(label, access.roles ?? [], getSessionVerifier, logger);

	/** Decisión por token; ver {@link DECISION_TTL_MS}. */
	const decisions = new Map<string, { reason: DenyReason | null; until: number }>();

	const decide = async (token: string): Promise<DenyReason | null> => {
		const cached = decisions.get(token);
		if (cached && cached.until > Date.now()) return cached.reason;

		const verifier = getSessionVerifier()!;
		const result = await verifier.verifyToken(token);
		let reason: DenyReason | null = null;
		if (!result.valid || !result.session) reason = "auth";
		// Contexto antes que nombre: cada organización seedea su propio "Admin", así que
		// comparar sólo el nombre dejaría a un admin de org entrar a un panel de plataforma.
		else if (globalOnly && result.session.user.orgId) reason = "org";
		else if (required.length > 0) {
			const roles = await verifier.resolveRoles(result.session.user.id, result.session.user.orgId);
			if (!accessAllowsRoles(roles, required)) reason = "role";
		}

		// Poda perezosa: el map se llena con un token por visitante y nada lo vaciaría. Barrer al
		// escribir alcanza —el tamaño es proporcional a las visitas de los últimos 10s— y evita un
		// timer que habría que apagar con el módulo.
		if (decisions.size > 256) {
			const now = Date.now();
			for (const [key, value] of decisions) if (value.until <= now) decisions.delete(key);
		}
		decisions.set(token, { reason, until: Date.now() + DECISION_TTL_MS });
		return reason;
	};

	return async (req: FastifyRequest): Promise<string | null> => {
		if (!getSessionVerifier()) {
			// Sin verificador no hay forma de autenticar a nadie: cerrado. Un despliegue sin IAM
			// no puede servir un panel de administración "porque no hay quien lo impida".
			logger.logWarn(`[access] ${label}: SessionManagerService no disponible; acceso denegado.`);
			return denyUrl(req, moduleName, "unavailable");
		}

		const token = extractToken(req, getSessionVerifier()!);
		if (!token) return denyUrl(req, moduleName, "auth");

		const reason = await decide(token);
		return reason ? denyUrl(req, moduleName, reason) : null;
	};
}
