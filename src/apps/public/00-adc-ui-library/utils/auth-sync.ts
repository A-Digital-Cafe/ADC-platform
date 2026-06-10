import { IS_DEV, getDevUrl } from "@common/utils/url-utils.js";
import { appendCsrfHeader } from "./csrf.js";

export type AuthChangeType = "logout" | "login";

const AUTH_CHANNEL_NAME = "adc-auth";
const AUTH_EVENT_KEY = "adc-auth-event";
const AUTH_USER_KEY = "adc-auth-user";
const AUTH_LOGOUT_PATH = "/api/auth/logout";
const AUTH_DEV_PORT = 3000;

const AVATAR_CHANNEL_NAME = "adc-avatar";
const AVATAR_EVENT_KEY = "adc-avatar-event";

/**
 * Identificador único por contexto de ejecución (página/iframe) para que los
 * emisores puedan distinguir su propio broadcast y evitar re-render redundante.
 */
const SENDER_ID = (() => {
	try {
		return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
	} catch {
		return `${Date.now()}-${Math.random()}`;
	}
})();

let logoutInFlight: Promise<void> | null = null;

/**
 * Fingerprint NO reversible del userId. Nunca persistimos el identificador real
 * en localStorage (accesible ante XSS y rastreable entre pestañas); solo un
 * marcador para detectar transiciones de sesión (login/cambio de cuenta).
 */
export function authMarkerFor(userId: string): string {
	let h = 5381;
	for (const ch of userId) h = ((h << 5) + h + (ch.codePointAt(0) ?? 0)) >>> 0;
	return `fp_${h.toString(36)}`;
}

export function getStoredAuthMarker(): string | null {
	try {
		return globalThis.localStorage?.getItem(AUTH_USER_KEY) ?? null;
	} catch {
		return null;
	}
}

export function setStoredAuthMarker(userId: string | null): void {
	try {
		if (userId) {
			globalThis.localStorage?.setItem(AUTH_USER_KEY, authMarkerFor(userId));
			return;
		}
		globalThis.localStorage?.removeItem(AUTH_USER_KEY);
	} catch {
		/* ignore */
	}
}

export function broadcastAuthChange(type: AuthChangeType): void {
	if (typeof BroadcastChannel !== "undefined") {
		try {
			const channel = new BroadcastChannel(AUTH_CHANNEL_NAME);
			channel.postMessage(type);
			channel.close();
		} catch {
			/* ignore */
		}
	}

	try {
		globalThis.localStorage?.setItem(AUTH_EVENT_KEY, `${type}:${Date.now()}`);
	} catch {
		/* ignore */
	}
}

export function setupAuthSync(onRemoteAuthChange: () => void): () => void {
	let channel: BroadcastChannel | undefined;
	const storageListener = (ev: StorageEvent) => {
		if (ev.key === AUTH_EVENT_KEY && ev.newValue) onRemoteAuthChange();
	};

	if (typeof BroadcastChannel !== "undefined") {
		try {
			channel = new BroadcastChannel(AUTH_CHANNEL_NAME);
			channel.onmessage = (ev) => {
				if (ev.data === "logout" || ev.data === "login") onRemoteAuthChange();
			};
		} catch {
			channel = undefined;
		}
	}

	globalThis.addEventListener?.("storage", storageListener);

	return () => {
		channel?.close();
		globalThis.removeEventListener?.("storage", storageListener);
	};
}

function getDefaultLogoutUrl(): string {
	return IS_DEV ? getDevUrl(AUTH_DEV_PORT, AUTH_LOGOUT_PATH) : AUTH_LOGOUT_PATH;
}

export async function forceLogoutAndRefresh(logoutUrl = getDefaultLogoutUrl()): Promise<void> {
	if (logoutInFlight !== null) {
		await logoutInFlight;
		return;
	}

	logoutInFlight = (async () => {
		try {
			const headers = await appendCsrfHeader("POST", logoutUrl, undefined, "include");
			await fetch(logoutUrl, {
				method: "POST",
				credentials: "include",
				headers,
				keepalive: true,
			});
		} catch {
			/* ignore */
		}

		setStoredAuthMarker(null);
		broadcastAuthChange("logout");
		globalThis.location?.reload();
	})();

	try {
		await logoutInFlight;
	} finally {
		logoutInFlight = null;
	}
}

/**
 * Notifica a todos los microfrontends (misma pestaña y otras pestañas) que el
 * avatar del usuario ha cambiado, para que cada consumidor refresque su UI
 * sin recargar la página ni re-fetchear la sesión (lo que rotaría el JWT/CSRF).
 *
 * Cuando `avatar` viene `null` significa "sin avatar" (fallback DiceBear).
 */
export interface AvatarUpdatePayload {
	userId: string;
	/** URL absoluta o relativa a renderizar, o `null` para fallback. */
	avatar: string | null;
	/** Permite invalidar caché del navegador para una misma URL (ej. re-subida). */
	cacheKey?: number;
	/** ID interno del emisor — los receptores deben ignorar sus propios mensajes. */
	sender?: string;
}

/**
 * Publica cambios de avatar emitidos en `broadcastAvatarUpdate`.
 * @public
 */
export function broadcastAvatarUpdate(payload: AvatarUpdatePayload): void {
	const enriched: AvatarUpdatePayload & { ts: number } = { ...payload, sender: SENDER_ID, ts: Date.now() };
	if (typeof BroadcastChannel !== "undefined") {
		try {
			const ch = new BroadcastChannel(AVATAR_CHANNEL_NAME);
			ch.postMessage(enriched);
			ch.close();
		} catch {
			/* ignore */
		}
	}
	try {
		globalThis.localStorage?.setItem(AVATAR_EVENT_KEY, JSON.stringify(enriched));
	} catch {
		/* ignore */
	}
}

/**
 * Suscribe a cambios de avatar emitidos por `broadcastAvatarUpdate`.
 * Ignora los mensajes propios (mismo `SENDER_ID`) para evitar re-render redundante
 * en el contexto que originó el cambio.
 * Devuelve una función de cleanup para llamar en `disconnectedCallback`.
 */
export function setupAvatarSync(onAvatarUpdate: (payload: AvatarUpdatePayload) => void): () => void {
	const handle = (data: AvatarUpdatePayload | undefined) => {
		if (!data?.userId) return;
		if (data.sender === SENDER_ID) return;
		onAvatarUpdate(data);
	};

	let channel: BroadcastChannel | undefined;
	if (typeof BroadcastChannel !== "undefined") {
		try {
			channel = new BroadcastChannel(AVATAR_CHANNEL_NAME);
			channel.onmessage = (ev) => handle(ev.data as AvatarUpdatePayload);
		} catch {
			channel = undefined;
		}
	}

	const storageListener = (ev: StorageEvent) => {
		if (ev.key !== AVATAR_EVENT_KEY || !ev.newValue) return;
		try {
			handle(JSON.parse(ev.newValue) as AvatarUpdatePayload);
		} catch {
			/* ignore */
		}
	};
	globalThis.addEventListener?.("storage", storageListener);

	return () => {
		channel?.close();
		globalThis.removeEventListener?.("storage", storageListener);
	};
}
