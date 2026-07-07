import { RegisterEndpoint, type EndpointCtx, UncommonResponse } from "../../EndpointManagerService/index.js";
import { AuthError } from "@common/types/custom-errors/AuthError.js";
import { IdentityError } from "@common/types/custom-errors/IdentityError.js";
import { buildDicebearAvatar } from "@common/utils/avatar.js";
import type { AttachmentsManager } from "../../../../utilities/attachments/attachments-utility/index.js";
import type IdentityManagerService from "../index.js";
import type { UserAvatarEndpointCtx } from "../permissions/userAvatarAttachments.js";
import * as AS from "./schemas/avatar.js";
import { SuccessResponse } from "./schemas/common.js";

interface PresignBody {
	fileName: string;
	mimeType: string;
	size: number;
}

interface SelectBody {
	source: string; // "default" | "custom" | "linked:<provider>" | "none"
}

interface AvatarOption {
	id: string; // "default" | "custom" | "linked:<provider>" | "none"
	label: string;
	url?: string; // URL para preview
	provider?: string;
}

const AVATAR_RATE_LIMIT = { max: 5, timeWindow: 60_000 };

/**
 * Endpoints HTTP para gestión del avatar del usuario autenticado.
 * Usa AttachmentsUtility para subida custom (S3 + Mongo) y persiste en
 * `user.metadata.customAvatar` + `user.metadata.avatarSource`.
 */
export class AvatarEndpoints {
	private static identity: IdentityManagerService;
	private static getAvatarAttachmentId: ((userId: string) => Promise<string | null>) | null = null;
	private static attachmentsManager: AttachmentsManager | null = null;

	public static init(
		identity: IdentityManagerService,
		getAvatarAttachmentId: (userId: string) => Promise<string | null>,
		attachmentsManager: AttachmentsManager | null
	): void {
		AvatarEndpoints.identity ??= identity;
		AvatarEndpoints.getAvatarAttachmentId ??= getAvatarAttachmentId;
		AvatarEndpoints.attachmentsManager ??= attachmentsManager;
	}

	static #manager(): AttachmentsManager {
		if (!AvatarEndpoints.attachmentsManager) {
			throw new IdentityError(503, "AVATAR_UPLOAD_UNAVAILABLE", "Subida de avatares no disponible (S3 no configurado)");
		}
		return AvatarEndpoints.attachmentsManager;
	}

	static #requireAuth(ctx: EndpointCtx): { userId: string } {
		if (!ctx.user?.id) {
			throw new AuthError(401, "UNAUTHORIZED", "No hay usuario autenticado");
		}
		return { userId: ctx.user.id };
	}

	static #ctxFor(callerId: string, targetUserId: string): UserAvatarEndpointCtx {
		// orgId null: los avatares cuentan SIEMPRE en la cuota personal.
		return { userId: callerId, targetUserId, orgId: null };
	}

	static async #getUser(userId: string, token?: string | null) {
		const user = await AvatarEndpoints.identity.users.getUser(userId, token ?? undefined);
		if (!user) throw new IdentityError(404, "USER_NOT_FOUND", "Usuario no encontrado");
		return user;
	}

	/**
	 * Lista las opciones de avatar disponibles para el usuario:
	 *  - cada `linkedAccount` con `providerAvatar`
	 *  - opción `custom` (si tiene attachment subido)
	 *  - opción `none` (fallback DiceBear)
	 */
	@RegisterEndpoint({
		method: "GET",
		url: "/api/identity/users/me/avatar/options",
		deferAuth: true,
		options: {
			tag: "IdentityManagerService/Avatars",
			summary: "Lista opciones de avatar del usuario actual",
			description: "Incluye `default` (DiceBear), cuentas vinculadas con avatar, `custom` (si hay) y `none`.",
			schema: { response: { 200: AS.AvatarOptionsResponse } },
		},
	})
	static async listOptions(ctx: EndpointCtx) {
		const { userId } = AvatarEndpoints.#requireAuth(ctx);
		const user = await AvatarEndpoints.#getUser(userId, ctx.token);
		const metadata = (user.metadata ?? {}) as { avatarSource?: string; customAvatar?: { attachmentId?: string } };

		const defaultOption: AvatarOption = {
			id: "default",
			label: "Default auto-avatar",
			url: buildDicebearAvatar(user.id || user.username || "default"),
		};
		const options: AvatarOption[] = [defaultOption];

		for (const acc of user.linkedAccounts ?? []) {
			if (acc.status === "linked" && acc.providerAvatar) {
				options.push({
					id: `linked:${acc.provider}`,
					label: acc.provider.charAt(0).toUpperCase() + acc.provider.slice(1),
					provider: acc.provider,
					url: acc.providerAvatar,
				});
			}
		}

		if (metadata.customAvatar?.attachmentId) {
			options.push({
				id: "custom",
				label: "Custom",
				url: `/api/identity/users/${encodeURIComponent(userId)}/avatar/raw`,
			});
		}

		options.push({ id: "none", label: "Sin avatar" });

		const fallbackLinked = user.linkedAccounts?.find((a) => a.status === "linked" && a.providerAvatar);

		let selected;
		if (typeof metadata.avatarSource === "string") selected = metadata.avatarSource;
		else if (metadata.customAvatar?.attachmentId) selected = "custom";
		else if (fallbackLinked) selected = `linked:${fallbackLinked.provider}`;
		else selected = "default";
		return { options, selected };
	}

	/**
	 * Genera URL pre-firmada para subir un nuevo avatar custom.
	 */
	@RegisterEndpoint({
		method: "POST",
		url: "/api/identity/users/me/avatar/presign",
		deferAuth: true,
		options: {
			tag: "IdentityManagerService/Avatars",
			summary: "Genera URL prefirmada para subir un avatar",
			description: "Devuelve una URL S3 prefirmada para subir un avatar custom. Confirmar luego con `/confirm`.",
			rateLimit: AVATAR_RATE_LIMIT,
			schema: { body: AS.PresignAvatarBody },
		},
	})
	static async presign(ctx: EndpointCtx<Record<string, string>, PresignBody>) {
		const { userId } = AvatarEndpoints.#requireAuth(ctx);
		const body = ctx.data;
		if (!body?.fileName || !body?.mimeType || !Number.isFinite(body?.size)) {
			throw new IdentityError(400, "MISSING_FIELDS", "fileName, mimeType y size son requeridos");
		}
		return AvatarEndpoints.#manager().presignUpload(AvatarEndpoints.#ctxFor(userId, userId), {
			ownerType: "user-avatar",
			ownerId: userId,
			fileName: body.fileName,
			mimeType: body.mimeType,
			size: body.size,
		});
	}

	/**
	 * Confirma la subida a S3, actualiza la metadata del usuario y borra el
	 * adjunto anterior si existía.
	 */
	@RegisterEndpoint({
		method: "POST",
		url: "/api/identity/users/me/avatar/:attachmentId/confirm",
		deferAuth: true,
		options: {
			tag: "IdentityManagerService/Avatars",
			summary: "Confirma la subida de un avatar custom",
			description: "Confirma la subida a S3, actualiza la metadata del usuario y borra el adjunto anterior si existía.",
			rateLimit: AVATAR_RATE_LIMIT,
			schema: { params: AS.AvatarAttachmentParams },
		},
	})
	static async confirm(ctx: EndpointCtx<{ attachmentId: string }>) {
		const { userId } = AvatarEndpoints.#requireAuth(ctx);
		const attachmentId = ctx.params.attachmentId;
		const manager = AvatarEndpoints.#manager();
		const userCtx = AvatarEndpoints.#ctxFor(userId, userId);

		const confirmed = await manager.confirmUpload(userCtx, attachmentId);

		// Borrar attachment custom previo (si lo había) y persistir nuevo en metadata
		const user = await AvatarEndpoints.#getUser(userId, ctx.token);
		const currentMeta = (user.metadata ?? {}) as { customAvatar?: { attachmentId?: string } };
		const previousId = currentMeta.customAvatar?.attachmentId;

		await AvatarEndpoints.identity.users.updateOwnMetadata(
			userId,
			{ customAvatar: { attachmentId: confirmed.id }, avatarSource: "custom" },
			ctx.token!
		);

		if (previousId && previousId !== confirmed.id) {
			try {
				await manager.delete(userCtx, previousId);
			} catch {
				// no bloquear: el nuevo ya quedó persistido, simplemente queda un huérfano
				// que el GC eventual de attachments limpiará.
			}
		}

		AvatarEndpoints.identity.permissions.invalidateUser(userId);
		return { attachment: confirmed, avatarSource: "custom" };
	}

	/**
	 * Elimina el avatar custom actual y limpia la selección si apuntaba a él.
	 */
	@RegisterEndpoint({
		method: "DELETE",
		url: "/api/identity/users/me/avatar",
		deferAuth: true,
		options: {
			tag: "IdentityManagerService/Avatars",
			summary: "Elimina el avatar custom actual",
			description: "Borra el avatar custom y, si era la fuente seleccionada, vuelve al avatar automático.",
			rateLimit: AVATAR_RATE_LIMIT,
			schema: { response: { 200: SuccessResponse } },
		},
	})
	static async removeCustom(ctx: EndpointCtx) {
		const { userId } = AvatarEndpoints.#requireAuth(ctx);
		const user = await AvatarEndpoints.#getUser(userId, ctx.token);
		const meta = (user.metadata ?? {}) as { customAvatar?: { attachmentId?: string }; avatarSource?: string };
		const attachmentId = meta.customAvatar?.attachmentId;

		if (attachmentId) {
			try {
				await AvatarEndpoints.#manager().delete(AvatarEndpoints.#ctxFor(userId, userId), attachmentId);
			} catch {
				// no-op
			}
		}

		// Si la fuente seleccionada era custom, fallback a auto (sin selección)
		const patch: Record<string, unknown> = { customAvatar: null };
		if (meta.avatarSource === "custom") patch.avatarSource = null;
		await AvatarEndpoints.identity.users.updateOwnMetadata(userId, patch, ctx.token!);

		AvatarEndpoints.identity.permissions.invalidateUser(userId);
		return { success: true };
	}

	/**
	 * Selecciona la fuente de avatar a usar: `default`, `custom`, `linked:<provider>` o `none`.
	 */
	@RegisterEndpoint({
		method: "PUT",
		url: "/api/identity/users/me/avatar/select",
		deferAuth: true,
		options: {
			tag: "IdentityManagerService/Avatars",
			summary: "Selecciona la fuente de avatar",
			description: "Fuente válida: `default`, `custom`, `none` o `linked:<provider>`.",
			rateLimit: AVATAR_RATE_LIMIT,
			skipIdempotency: true,
			schema: { body: AS.SelectAvatarBody, response: { 200: AS.AvatarSourceResponse } },
		},
	})
	static async select(ctx: EndpointCtx<Record<string, string>, SelectBody>) {
		const { userId } = AvatarEndpoints.#requireAuth(ctx);
		const raw = ctx.data?.source;
		if (typeof raw !== "string" || !raw) {
			throw new IdentityError(400, "MISSING_FIELDS", "`source` requerido");
		}

		const user = await AvatarEndpoints.#getUser(userId, ctx.token);
		const meta = (user.metadata ?? {}) as { customAvatar?: { attachmentId?: string } };

		// Validar la fuente
		if (raw === "none" || raw === "default") {
			// permitido
		} else if (raw === "custom") {
			if (!meta.customAvatar?.attachmentId) {
				throw new IdentityError(400, "NO_CUSTOM_AVATAR", "No hay avatar custom subido");
			}
		} else if (raw.startsWith("linked:")) {
			const provider = raw.slice("linked:".length);
			const acc = user.linkedAccounts?.find((a) => a.provider === provider && a.status === "linked");
			if (!acc?.providerAvatar) {
				throw new IdentityError(400, "INVALID_PROVIDER", `No hay avatar para el proveedor ${provider}`);
			}
		} else {
			throw new IdentityError(400, "INVALID_SOURCE", "Fuente inválida");
		}

		await AvatarEndpoints.identity.users.updateOwnMetadata(userId, { avatarSource: raw }, ctx.token!);
		AvatarEndpoints.identity.permissions.invalidateUser(userId);
		return { avatarSource: raw };
	}

	/**
	 * Endpoint público: redirige al avatar custom del usuario (presigned S3).
	 * Devuelve 404 si el usuario no existe o no tiene avatar custom.
	 */
	@RegisterEndpoint({
		method: "GET",
		url: "/api/identity/users/:userId/avatar/raw",
		deferAuth: true,
		options: {
			tag: "IdentityManagerService/Avatars",
			summary: "Redirige al avatar custom de un usuario",
			description: "Endpoint público: responde 302 hacia la URL S3 prefirmada. 404 si el usuario no tiene avatar custom.",
			rateLimit: { max: 60, timeWindow: 60_000 },
			schema: { params: AS.AvatarUserParams },
		},
	})
	static async raw(ctx: EndpointCtx<{ userId: string }>) {
		const targetUserId = ctx.params.userId;
		if (!targetUserId) throw new IdentityError(400, "MISSING_FIELDS", "userId requerido");

		// Lectura mínima sin permisos: el avatar es público para cualquier usuario que aparezca como autor.
		const getAvatarAttachmentId = AvatarEndpoints.getAvatarAttachmentId;
		if (!getAvatarAttachmentId) throw new IdentityError(503, "AVATAR_UPLOAD_UNAVAILABLE", "Lookup de avatares no disponible");
		const attachmentId = await getAvatarAttachmentId(targetUserId);
		if (!attachmentId) throw new IdentityError(404, "AVATAR_NOT_FOUND", "Avatar no encontrado");

		const callerId = ctx.user?.id ?? "";
		const { url } = await AvatarEndpoints.#manager().getDownloadUrl(AvatarEndpoints.#ctxFor(callerId, targetUserId), attachmentId, {
			inline: true,
		});
		throw UncommonResponse.redirect(url, { status: 302 });
	}
}
