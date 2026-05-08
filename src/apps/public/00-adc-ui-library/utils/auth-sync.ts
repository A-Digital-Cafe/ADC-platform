import { IS_DEV, getDevUrl } from "@common/utils/url-utils.js";
import { appendCsrfHeader } from "./csrf.js";

export type AuthChangeType = "logout" | "login";

const AUTH_CHANNEL_NAME = "adc-auth";
const AUTH_EVENT_KEY = "adc-auth-event";
const AUTH_USER_KEY = "adc-auth-user";
const AUTH_LOGOUT_PATH = "/api/auth/logout";
const AUTH_DEV_PORT = 3000;

let logoutInFlight: Promise<void> | null = null;

export function getStoredAuthUser(): string | null {
	try {
		return globalThis.localStorage?.getItem(AUTH_USER_KEY) ?? null;
	} catch {
		return null;
	}
}

export function setStoredAuthUser(userId: string | null): void {
	try {
		if (userId) {
			globalThis.localStorage?.setItem(AUTH_USER_KEY, userId);
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

		setStoredAuthUser(null);
		broadcastAuthChange("logout");
		globalThis.location?.reload();
	})();

	try {
		await logoutInFlight;
	} finally {
		logoutInFlight = null;
	}
}
