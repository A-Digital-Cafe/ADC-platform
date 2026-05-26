import { createAdcApi } from "@ui-library/utils/adc-fetch";
import type { ClientUser } from "@common/types/identity/User.ts";

const api = createAdcApi({
	basePath: "/api/identity",
	devPort: 3000,
	credentials: process.env.NODE_ENV === "development" ? "include" : "same-origin",
});

const authApi = createAdcApi({
	basePath: "/api/auth",
	devPort: 3000,
	credentials: process.env.NODE_ENV === "development" ? "include" : "same-origin",
});

export interface UserProfileMetadata {
	name?: string;
	lastName?: string;
	birthDate?: string;
}

export type AvatarSource = "default" | "custom" | "none" | `linked:${string}`;

export interface AvatarOption {
	id: AvatarSource;
	label: string;
	url?: string;
	provider?: string;
}

export interface AvatarOptionsResponse {
	options: AvatarOption[];
	selected: AvatarSource | null;
}

export interface PresignUploadResponse {
	attachmentId: string;
	uploadUrl: string;
	headers: Record<string, string>;
	expiresAt: string;
}

/** Idempotency helper */
function createIdempotencyKey(data: unknown, mode: "hash" | "uuid" = "hash") {
	if (mode === "uuid") return crypto.randomUUID();

	const str = JSON.stringify(data);
	let h = 5381;
	for (const ch of str) h = ((h << 5) + h + ch.codePointAt(0)!) >>> 0;
	return h.toString(36);
}

export const accountApi = {
	// USERS

	getUser: (userId: string) => api.get<ClientUser>(`/users/${userId}`),

	getCurrentUser: () => api.get<ClientUser>("/users/me"),

	updateUser: (userId: string, data: Partial<ClientUser>) =>
		api.put<ClientUser>(`/users/${userId}`, { body: data, idempotencyKey: createIdempotencyKey(data) }),

	updateCurrentUser: async (metadata: UserProfileMetadata) => {
		const { data: user } = await api.get<ClientUser>("/users/me");

		if (!user) {
			throw new Error("AUTHENTICATED_USER_NOT_FOUND");
		}

		return accountApi.updateUser(user.id, { metadata });
	},

	/**
	 * Solicita la eliminación de la cuenta del usuario actual.
	 * Usa el endpoint self-delete (`DELETE /users/me`) que programa el borrado en 30 días.
	 */
	deleteCurrentUser: (reason?: string) =>
		api.delete<{ success: true; scheduledDeletionInDays: number }>("/users/me", {
			body: reason ? { reason } : undefined,
			idempotencyKey: crypto.randomUUID(),
		}),

	// AVATARS

	/** Lista las opciones de avatar disponibles para el usuario. */
	getAvatarOptions: () => api.get<AvatarOptionsResponse>("/users/me/avatar/options"),

	/**
	 * Sube un archivo como avatar custom. Flujo: presign → PUT a S3 → confirm.
	 * Devuelve la fuente seleccionada (siempre "custom").
	 */
	uploadCustomAvatar: async (file: File): Promise<{ avatarSource: AvatarSource }> => {
		const presign = await api.post<PresignUploadResponse>("/users/me/avatar/presign", {
			body: { fileName: file.name, mimeType: file.type || "application/octet-stream", size: file.size },
			idempotencyKey: createIdempotencyKey({ name: file.name, size: file.size, lastModified: file.lastModified }),
		});
		if (!presign.success || !presign.data) {
			throw new Error("AVATAR_UPLOAD_START_FAILED");
		}

		// Subida directa al storage (S3) — sin credentials, sin csrf
		const putRes = await fetch(presign.data.uploadUrl, {
			method: "PUT",
			body: file,
			headers: presign.data.headers,
		});
		if (!putRes.ok) {
			throw new Error(`AVATAR_UPLOAD_HTTP_${putRes.status}`);
		}

		const confirm = await api.post<{ avatarSource: AvatarSource }>(
			`/users/me/avatar/${encodeURIComponent(presign.data.attachmentId)}/confirm`,
			{ idempotencyKey: presign.data.attachmentId }
		);
		if (!confirm.success || !confirm.data) {
			throw new Error("AVATAR_UPLOAD_CONFIRM_FAILED");
		}
		return confirm.data;
	},

	/** Elimina el avatar custom actual (S3 + metadata). */
	removeCustomAvatar: () => api.delete("/users/me/avatar", { idempotencyKey: crypto.randomUUID() }),

	/** Selecciona la fuente de avatar a mostrar (default, custom, linked:<provider> o none). */
	selectAvatarSource: (source: AvatarSource) =>
		api.put<{ avatarSource: AvatarSource }>("/users/me/avatar/select", {
			body: { source },
		}),

	// AUTH / SECURITY

	changePassword: (currentPassword: string, newPassword: string) => {
		return api.post("/users/change-password", {
			body: { currentPassword, newPassword },
			idempotencyKey: crypto.randomUUID(),
		});
	},

	logout: () => authApi.post("/logout", { silent: true }),
};
