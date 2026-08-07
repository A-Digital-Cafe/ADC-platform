import { RegisterEndpoint, type EndpointCtx } from "../../../core/EndpointManagerService/index.js";
import { AuthError } from "@common/types/custom-errors/AuthError.ts";
import type { IIdentityManagerService } from "@common/types/identity/IIdentityManagerService.js";
import { buildLegalAcceptance, currentLegalVersions, pendingLegalDocs, type LegalAcceptance } from "@common/utils/legal-docs.js";
import * as LS from "./schemas/legal.js";

interface LegalEndpointsDeps {
	internalIdentity: ReturnType<IIdentityManagerService["_internal"]> | null;
	logger: { logInfo: (msg: string) => void; logError: (msg: string) => void };
}

/** Cuerpo de `POST /api/auth/legal/accept` (ver `LegalAcceptBody`). */
interface LegalAcceptRequest {
	accepted?: boolean;
	termsVersion?: string;
	privacyVersion?: string;
	ageConfirmed?: boolean;
}

/**
 * Re-aceptación de los documentos legales por parte de cuentas que ya existían.
 *
 * Deliberadamente NO hay middleware que responda 403 mientras la aceptación esté pendiente: el
 * gate lo hace la UI (`adc-legal-gate`), que deja fuera a `help` y a `my-account`. Si aceptar
 * fuera la única salida no sería consentimiento, y además quedaría trabado el ejercicio de
 * derechos (leer el texto, pedir los datos, darse de baja), que tiene que poder hacerse sin
 * aceptar nada.
 */
export class LegalEndpoints {
	private static deps: LegalEndpointsDeps;

	static init(deps: LegalEndpointsDeps): void {
		LegalEndpoints.deps ??= deps;
	}

	@RegisterEndpoint({
		method: "GET",
		url: "/api/auth/legal/status",
		deferAuth: true,
		options: {
			tag: "SessionManagerService/Auth",
			summary: "Documentos legales pendientes de aceptar",
			description:
				"Documentos cuya versión vigente ya entró en vigor (`effectiveFrom`) y que la constancia del usuario no cubre. `pending` vacío = nada que aceptar.",
			rateLimit: { max: 60, timeWindow: 60_000 },
			schema: { response: { 200: LS.LegalStatusResponse } },
		},
	})
	static async handleStatus(ctx: EndpointCtx): Promise<unknown> {
		if (!ctx.user) throw new AuthError(401, "UNAUTHORIZED", "No hay sesión activa");

		const acceptance = await LegalEndpoints.#readAcceptance(ctx.user.id, ctx.token ?? undefined);
		return {
			pending: pendingLegalDocs(acceptance).map((doc) => ({
				id: doc.id,
				label: doc.label,
				version: doc.version,
				effectiveFrom: doc.effectiveFrom,
				href: doc.href,
			})),
			acceptedAt: acceptance?.acceptedAt,
			acceptedVersions:
				acceptance?.termsVersion && acceptance.privacyVersion
					? { termsVersion: acceptance.termsVersion, privacyVersion: acceptance.privacyVersion }
					: undefined,
		};
	}

	@RegisterEndpoint({
		method: "POST",
		url: "/api/auth/legal/accept",
		deferAuth: true,
		options: {
			tag: "SessionManagerService/Auth",
			summary: "Acepta la versión vigente de los documentos legales",
			description:
				"Graba una constancia nueva (`via: re-acceptance`) con la fecha sellada por el servidor. Rechaza el pedido si las versiones enviadas no son las vigentes.",
			rateLimit: { max: 5, timeWindow: 300_000 },
			schema: { body: LS.LegalAcceptBody, response: { 200: LS.LegalAcceptResponse } },
		},
	})
	static async handleAccept(ctx: EndpointCtx<Record<string, string>, LegalAcceptRequest>): Promise<unknown> {
		if (!ctx.user) throw new AuthError(401, "UNAUTHORIZED", "No hay sesión activa");
		if (!ctx.data?.accepted) {
			throw new AuthError(400, "LEGAL_NOT_ACCEPTED", "Debés aceptar los Términos y Condiciones y la Política de Privacidad");
		}

		const body = ctx.data;
		const current = currentLegalVersions();
		if (body.termsVersion !== current.termsVersion || body.privacyVersion !== current.privacyVersion) {
			throw new AuthError(
				409,
				"LEGAL_VERSION_MISMATCH",
				"Los Términos o la Política de Privacidad se actualizaron. Recargá la página para leer la versión vigente."
			);
		}

		const previous = await LegalEndpoints.#readAcceptance(ctx.user.id, ctx.token ?? undefined);
		// La edad se declaró en el alta: la re-aceptación la arrastra en vez de volver a pedirla.
		// Las cuentas sin constancia previa (anteriores a que se guardara) sí la declaran de nuevo.
		if (!(previous?.ageConfirmed ?? body.ageConfirmed)) {
			throw new AuthError(400, "AGE_NOT_CONFIRMED", "Debés confirmar que cumplís con la edad mínima");
		}

		const acceptance = buildLegalAcceptance("re-acceptance", true);
		const users = LegalEndpoints.deps.internalIdentity?.users;
		if (!users) throw new AuthError(503, "SERVICE_UNAVAILABLE", "Servicio de identidad no disponible");

		await users.updateOwnMetadata(ctx.user.id, { legalAcceptance: acceptance }, ctx.token ?? undefined);
		LegalEndpoints.deps.logger.logInfo(
			`[Legal] ${ctx.user.id} aceptó Términos ${acceptance.termsVersion} y Privacidad ${acceptance.privacyVersion}`
		);

		return { success: true, acceptedAt: acceptance.acceptedAt };
	}

	static async #readAcceptance(userId: string, token?: string): Promise<Partial<LegalAcceptance> | null> {
		const users = LegalEndpoints.deps.internalIdentity?.users;
		if (!users) return null;
		try {
			const user = await users.getUser(userId, token);
			return (user?.metadata?.legalAcceptance as Partial<LegalAcceptance> | undefined) ?? null;
		} catch (err: any) {
			LegalEndpoints.deps.logger.logError(`[Legal] No se pudo leer la constancia de ${userId}: ${err?.message || err}`);
			return null;
		}
	}
}
