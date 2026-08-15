/**
 * Alta de un nodo virgen: pedirle su configuración al clúster antes de completar el arranque.
 *
 * El corte va entre el banner de identidad del nodo y `docker:compose`: ahí el proceso ya sabe quién
 * es y todavía **no levantó infraestructura ni cargó módulos**, que es lo único que permite esperar
 * sin dejar nada a medias. Un paso más adelante ya habría levantado su propio Mongo vacío en
 * paralelo al del clúster.
 *
 * Escribe en `env/` para el próximo arranque —el token es de un solo uso— y en `process.env` para
 * éste, porque la interpolación de los `config.json` (`${MONGO_HOST}`) ocurre después y lee de ahí.
 * La excepción de `process.env` es la misma que en `cluster-env.ts`, agravada: en un nodo virgen ni
 * siquiera existe todavía el archivo del que se leerían.
 */

import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync, chmodSync } from "node:fs";
import { resolve } from "node:path";
import type { ILogger } from "../../interfaces/utils/ILogger.js";
import { ENV_GROUP_ORDER, type EnvGroup } from "../../common/utils/env-manifest.js";
import { advertisedAddress, nodeId, nodeSite } from "../../common/utils/cluster-env.js";

/** Carpeta de configuración de la raíz, la misma que lee `load-env.ts`. */
const ENV_DIR = "env";
/**
 * Marca de que este nodo ya canjeó su token: sin ella el segundo arranque se comería un 409 con un
 * token ya usado. Es un archivo y no una variable para que sobreviva a que alguien reescriba
 * `env/host.env` desde el panel.
 */
const JOINED_MARKER = ".joined";

/** Grupos que un secundario NO debería recibir enteros del primario. */
const NEVER_OVERWRITE: ReadonlySet<EnvGroup> = new Set(["host"]);

const MAX_ATTEMPTS = 12;
const BASE_DELAY_MS = 2_000;
const MAX_DELAY_MS = 60_000;
const REQUEST_TIMEOUT_MS = 15_000;

/** Lo que devuelve el primario: variables agrupadas por archivo destino. */
interface JoinResponse {
	nodeId: string;
	/** `{ storage: { MONGO_HOST: "…" }, secrets: { … } }`. Sólo grupos conocidos. */
	env: Partial<Record<EnvGroup, Record<string, string>>>;
	/**
	 * `true` si la respuesta incluyó el grupo de secretos. En un clúster sano siempre lo es, así que
	 * un `false` no es una variante del alta: el primario no tiene ningún secreto cargado.
	 */
	includedSecrets: boolean;
}

export interface BootstrapResult {
	/** `false` = no había nada que hacer (nodo ya configurado o sin variables de alta). */
	joined: boolean;
	/** Cuántas variables se aplicaron. */
	applied: number;
	groups: EnvGroup[];
}

function env(name: string): string | undefined {
	const value = process.env[name]?.trim();
	return value || undefined;
}

/** `https://…` o `http://…` a un host: se le van a mandar secretos, así que se valida la forma. */
const JOIN_URL_RE = /^https?:\/\/[a-zA-Z0-9._:[\]-]+(\/[\w./-]*)?$/;

const SINGLE_QUOTE_ESCAPE = String.raw`'\''`;

/**
 * Escapa un valor para un archivo `.env`: sin esto un secreto con un `#` o un espacio se guardaría
 * truncado y el síntoma aparecería en el próximo reinicio, no ahora.
 */
function quote(value: string): string {
	if (/^[A-Za-z0-9_./:@-]*$/.test(value)) return value;
	return `'${value.replaceAll("'", SINGLE_QUOTE_ESCAPE)}'`;
}

/** `0600` para lo que contiene secretos o identifica al nodo, igual que hace el migrador. */
function permsFor(group: EnvGroup): number {
	return group === "secrets" || group === "host" ? 0o600 : 0o644;
}

/**
 * Reescribe `env/<grupo>.env` con lo recibido, **conservando lo que ya estaba** y sin duplicar
 * claves. Lo que ya tenía valor local gana: el alta trae la configuración que falta, no pisa
 * decisiones que alguien tomó en esta máquina.
 */
function mergeIntoGroupFile(dir: string, group: EnvGroup, values: Record<string, string>): number {
	const file = resolve(dir, `${group}.env`);
	const existing = existsSync(file) ? readFileSync(file, "utf-8") : "";
	const already = new Set(
		existing
			.split("\n")
			.map((line) => /^[ \t]*([A-Z][A-Z0-9_]*)[ \t]*=/.exec(line)?.[1])
			.filter((name): name is string => !!name)
	);
	const added = Object.entries(values).filter(([key]) => !already.has(key));
	if (added.length === 0) return 0;

	const header = existing.trimEnd() ? `${existing.trimEnd()}\n\n` : "";
	const block = [
		`# Recibido del clúster en el alta de este nodo (${new Date().toISOString()}).`,
		"# Editable: lo que esté acá gana sobre lo que mande el clúster en un alta posterior.",
		...added.map(([key, value]) => `${key}=${quote(value)}`),
		"",
	].join("\n");
	writeFileSync(file, header + block, { mode: permsFor(group) });
	tightenOnly(file, permsFor(group));
	return added.length;
}

/**
 * Ajusta los permisos **sólo si hay que cerrarlos**, nunca para abrirlos: un `chmod` incondicional
 * devolvería a 0644 un `env/storage.env` que el operador hubiera endurecido a 0600, en silencio y
 * durante el alta de otro nodo.
 */
function tightenOnly(file: string, target: number): void {
	let current: number;
	try {
		current = statSync(file).mode & 0o777;
	} catch {
		chmodSync(file, target);
		return;
	}
	// La intersección nunca agrega un permiso que el archivo no tuviera.
	const next = current & target;
	if (next !== current) chmodSync(file, next);
}

async function redeem(joinUrl: string, token: string, logger: ILogger): Promise<JoinResponse> {
	const url = `${joinUrl.replace(/\/+$/, "")}/api/network/join`;
	const response = await fetch(url, {
		method: "POST",
		headers: { "content-type": "application/json", accept: "application/json" },
		body: JSON.stringify({ token, nodeId: nodeId(), site: nodeSite(), advertise: advertisedAddress() }),
		signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
	});
	if (!response.ok) {
		let detail = `HTTP ${response.status}`;
		try {
			const body = (await response.json()) as { message?: string };
			if (body?.message) detail = body.message;
		} catch {
			// Cuerpo no-JSON: el status alcanza.
		}
		// Un 409 (token ya usado) o un 403 (fuera del CIDR de la overlay) no se arreglan reintentando.
		const terminal = response.status === 403 || response.status === 409 || response.status === 404;
		const error = new Error(detail) as Error & { terminal?: boolean };
		error.terminal = terminal;
		logger.logError(`[alta] el clúster rechazó el token: ${detail}`);
		throw error;
	}
	return (await response.json()) as JoinResponse;
}

function sleep(ms: number): Promise<void> {
	return new Promise((r) => setTimeout(r, ms));
}

/**
 * Si este nodo tiene variables de alta y todavía no las canjeó, pide su configuración y la aplica.
 *
 * **No arranca a medias**: si el clúster no contesta, reintenta con backoff y aborta el arranque. Un
 * nodo que siguiera sin configuración levantaría su propio Mongo vacío y serviría con otros
 * secretos, y nada avisaría hasta que un usuario perdiera la sesión al saltar de nodo.
 */
export async function bootstrapNodeIfPending(basePath: string, logger: ILogger): Promise<BootstrapResult> {
	const joinUrl = env("ADC_NODE_JOIN_URL");
	const token = env("ADC_NODE_JOIN_TOKEN");
	if (!joinUrl || !token) return { joined: false, applied: 0, groups: [] };

	const dir = resolve(basePath, "..", ENV_DIR);
	const marker = resolve(dir, JOINED_MARKER);
	if (existsSync(marker)) {
		logger.logDebug(`[alta] este nodo ya canjeó su token (${JOINED_MARKER}); se sigue con el arranque normal.`);
		return { joined: false, applied: 0, groups: [] };
	}
	if (!JOIN_URL_RE.test(joinUrl)) {
		throw new Error(`ADC_NODE_JOIN_URL no tiene forma de URL: '${joinUrl}'. Es a donde se le mandan los secretos de este nodo, así que no se adivina.`);
	}

	logger.logInfo(`[alta] nodo '${nodeId()}' en espera de configuración: canjeando el token contra ${joinUrl}…`);
	const response = await redeemWithBackoff(joinUrl, token, logger);

	if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o755 });
	const { applied, groups } = applyConfig(dir, response, logger);

	writeFileSync(marker, `${nodeId()} ${new Date().toISOString()}\n`, { mode: 0o600 });
	const where = groups.length > 0 ? groups.join(", ") : "ningún archivo nuevo";
	if (response.includedSecrets) {
		logger.logOk(`[alta] configuración recibida: ${applied} variable(s) en ${where} (incluye secretos compartidos).`);
	} else {
		// No es un modo del alta sino un clúster mal cargado: sin los secretos compartidos el nodo
		// emite sesiones que el resto rechaza y firma correo que no valida, sin fallar al arrancar.
		logger.logWarn(
			`[alta] configuración recibida: ${applied} variable(s) en ${where}, pero SIN los secretos compartidos. ` +
				"El primario no tiene ninguno cargado para este nodo: copiá `env/secrets.env` a mano y reiniciá, o este nodo va a " +
				"rechazar las sesiones que emitan los otros."
		);
	}
	return { joined: true, applied, groups };
}

/**
 * Reintenta el canje con backoff exponencial. Un rechazo **terminal** (token usado, fuera de la red
 * privada, endpoint inexistente) corta en el acto.
 */
async function redeemWithBackoff(joinUrl: string, token: string, logger: ILogger): Promise<JoinResponse> {
	for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
		try {
			return await redeem(joinUrl, token, logger);
		} catch (error) {
			if ((error as { terminal?: boolean }).terminal) throw error;
			if (attempt === MAX_ATTEMPTS) {
				throw new Error(
					`[alta] no se pudo obtener la configuración del clúster tras ${MAX_ATTEMPTS} intentos: ${(error as Error).message}. ` +
						"El arranque se detiene a propósito: un nodo sin configuración levantaría su propia infraestructura vacía en paralelo.",
					{ cause: error }
				);
			}
			const delay = Math.min(MAX_DELAY_MS, BASE_DELAY_MS * 2 ** (attempt - 1));
			logger.logWarn(`[alta] intento ${attempt}/${MAX_ATTEMPTS} falló (${(error as Error).message}); reintento en ${Math.round(delay / 1000)}s.`);
			await sleep(delay);
		}
	}
	// Inalcanzable (el último intento lanza); está para que el retorno no admita `undefined`.
	throw new Error("[alta] canje sin resultado");
}

/** Escribe lo recibido en `env/` y lo inyecta en este proceso. Devuelve qué se aplicó. */
function applyConfig(dir: string, response: JoinResponse, logger: ILogger): { applied: number; groups: EnvGroup[] } {
	let applied = 0;
	const groups: EnvGroup[] = [];
	for (const group of ENV_GROUP_ORDER) {
		const values = response.env[group];
		if (!values || Object.keys(values).length === 0) continue;
		if (NEVER_OVERWRITE.has(group)) {
			// Recibir el grupo `host` del primario sería recibir la identidad de OTRA máquina.
			logger.logWarn(`[alta] el clúster mandó variables del grupo '${group}' y se ignoran: ese grupo es propio de cada nodo.`);
			continue;
		}
		const count = mergeIntoGroupFile(dir, group, values);
		// A `process.env` van TODAS y no sólo las escritas: las que ya estaban en el archivo también
		// tienen que llegar al entorno de este proceso.
		for (const [key, value] of Object.entries(values)) process.env[key] ??= value;
		if (count > 0) groups.push(group);
		applied += count;
	}
	return { applied, groups };
}
