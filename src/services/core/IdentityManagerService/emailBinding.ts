import type { UserManager } from "./dao/index.js";
import type { ILogger } from "../../../interfaces/utils/ILogger.js";
import type { INotificationEmailSender } from "@common/types/notifications/INotificationService.ts";
import type { IAuditLogService } from "@common/types/security/AuditLog.ts";
import type { CapabilityToken } from "@common/security/Capability.ts";
import { isInternalAddress } from "@common/utils/email-address.ts";
import { hashEmails } from "@common/utils/identityHash.ts";
import { buildEmailAlreadyRegisteredBody, buildEmailConfirmBody } from "./emails.js";

/** Alta (`/api/auth/register`) o rectificación del email propio (`/me/change-email`). */
type EmailBindMode = "signup" | "change";

/** Vincula (o no) una dirección a una cuenta sin decirle jamás al que la tipeó si ya existía. */
export type EmailBinder = (userId: string, email: string, mode: EmailBindMode) => Promise<void>;

export interface EmailBinderDeps {
	/** Manager SIN auth: el alta corre pre-sesión y el titular no tiene READ sobre usuarios. */
	users: UserManager;
	logger: ILogger;
	/** Capability de Identity, para auditar y para lo que exija scope. */
	cap: CapabilityToken;
	getSender: () => INotificationEmailSender | null;
	getAudit: () => IAuditLogService | null;
	buildConfirmUrl: (confirmToken: string) => string;
}

/**
 * Construye la vinculación **neutral** de una dirección de correo a una cuenta: la pieza que hace
 * indistinguibles el alta con un email libre y el alta con un email ya registrado.
 *
 * Las dos ramas crean la cuenta y emiten la sesión igual (eso lo garantiza el endpoint); acá sólo
 * cambia dónde termina la dirección:
 *
 *  - **Ya es de otra cuenta** → se le avisa al TITULAR (a su casilla, puenteable a su buzón de
 *    plataforma) que alguien la tipeó, sin token ni datos de su cuenta, y en la cuenta que la
 *    tipeó queda un `emailChangePending` sin hash: se ve igual que un pedido normal hasta vencer,
 *    pero no se puede canjear. La cuenta nueva queda sin email.
 *  - **Libre y entregable** → se emite el token de un solo uso y se manda el enlace; la dirección
 *    se vincula recién al canjearlo.
 *
 * NUNCA lanza: quien la llama ya respondió (o está por responder) lo mismo pase lo que pase, y una
 * excepción que se propagara sería, ella misma, el oráculo.
 */
export function createEmailBinder(deps: EmailBinderDeps): EmailBinder {
	const { users, logger, cap, getSender, getAudit, buildConfirmUrl } = deps;

	async function bindTakenAddress(userId: string, ownerId: string, email: string, mode: EmailBindMode): Promise<void> {
		const sender = getSender();
		if (sender) {
			const body = buildEmailAlreadyRegisteredBody();
			// `best-effort` a propósito: es la garantía que puentea al buzón de plataforma del
			// TITULAR (de ahí el `userId: ownerId`, no el de quien tipeó la dirección), y por eso
			// este aviso sí se entrega con el envío externo deshabilitado.
			await sender.sendSystemEmail({ to: email, userId: ownerId, deliveryGuarantee: "best-effort", ...body });
		}
		await users.markEmailChangeUnconfirmable(userId, email);
		// Sólo el hash: el audit log descarta cualquier string con "@" (tripwire anti-PII), así que
		// ni la dirección ni su máscara sobrevivirían. El hash es el mismo que compara la ban-list.
		void getAudit()?.record(cap, {
			action: "identity.email-bind-collision",
			actorUserId: userId,
			targetUserId: userId,
			targetResource: "identity:user",
			context: { mode, emailHash: hashEmails([email])[0] ?? null },
		});
	}

	return async function bindEmailNeutrally(userId: string, email: string, mode: EmailBindMode): Promise<void> {
		try {
			const existing = await users.getUserByEmail(email);
			if (existing && existing.id !== userId) {
				await bindTakenAddress(userId, existing.id, email, mode);
				return;
			}

			const sender = getSender();
			const policy = sender?.getDeliveryPolicy?.();
			if (sender && !(policy?.internalOnly && !isInternalAddress(email, policy.rootDomain))) {
				const { confirmToken } = await users.requestEmailChange(userId, email);
				const body = buildEmailConfirmBody(buildConfirmUrl(confirmToken));
				// `exact`: el enlace prueba el control de ESA casilla, así que puentearlo al buzón de
				// plataforma de quien lo pidió convertiría la confirmación en un trámite vacío.
				await sender.sendSystemEmail({ to: email, userId, deliveryGuarantee: "exact", ...body });
				return;
			}

			// Sin transporte (o con envío externo deshabilitado y una dirección de afuera) no hay
			// confirmación posible. La asimetría depende SÓLO de la política de entrega del despliegue
			// y del dominio de la dirección — nunca de si la dirección existe—, así que no informa
			// nada sobre la casilla ajena.
			//
			// Residual asumido: en ese modo quien se registra puede deducir, MIRANDO SU PROPIA CUENTA
			// después, si la dirección estaba libre (quedó vinculada) o no (quedó el pedido pendiente).
			// Cuesta un alta completa por consulta y el alta está rate-limitada; el alta lo asume para
			// no dejar a la persona sin ningún canal de correo, y la rectificación no (ahí el endpoint
			// responde 503 antes de llegar acá).
			if (mode === "signup") {
				await users.updateUser(userId, { email });
				return;
			}
			logger.logWarn(`[Identity] Cambio de email de ${userId} sin transporte disponible: no se emitió enlace`);
		} catch (error: any) {
			logger.logWarn(`[Identity] Vinculación de email (${mode}) de ${userId} incompleta: ${error?.message || error}`);
		}
	};
}
