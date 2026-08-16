/**
 * Renovación proactiva de la sesión.
 *
 * El access token vive 15 minutos y la cookie es HttpOnly, así que el cliente no
 * puede leer su vencimiento: lo toma del `expiresAt` que publican `/api/auth/session`
 * y `/api/auth/refresh`, y renueva ANTES de que expire. Así un 401 significa "sesión
 * realmente terminada", no "toca renovar" (y no ensucia el log de auditoría con
 * `[AUTHZ-DENY]`).
 *
 * Coordinación: `navigator.locks` serializa las pestañas del MISMO origen — la
 * primera renueva y las demás, al entrar al lock, ya ven el vencimiento nuevo y no
 * salen a la red. Entre orígenes distintos (cada app federada es uno) no hay
 * coordinación posible desde el cliente; de esa concurrencia se encarga la ventana
 * de gracia del servidor (`RefreshTokenRepository.resolveCurrent`).
 */

import { IS_DEV, getDevUrl } from "@common/utils/url-utils.js";
import { appendCsrfHeader } from "./csrf.js";

const REFRESH_PATH = "/api/auth/refresh";
const AUTH_DEV_PORT = 3000;

/** Clave (por origen) donde se recuerda el vencimiento. Es sólo un timestamp: no es sensible. */
const EXPIRY_KEY = "adc-auth-expires-at";
/**
 * Clave donde se anota "acá no hay sesión". Sin esto, cada request de un visitante anónimo
 * que recibe 401 dispara su propio POST /refresh (y cada copia federada del módulo tiene su
 * propio estado en memoria, así que se multiplican). Con TTL corto: es un anti-avalancha de
 * la carga de página, no una decisión permanente — a quien SÍ tenga refresh token vivo hay
 * que dejarlo recuperar la sesión enseguida.
 */
const ABSENT_KEY = "adc-auth-absent-at";
const ABSENT_TTL_MS = 60_000;
/**
 * Canal propio: el canal `adc-auth` de auth-sync recarga la página ante cualquier
 * mensaje, y una renovación no debe recargar nada.
 */
const REFRESH_CHANNEL = "adc-auth-refresh";
const LOCK_NAME = "adc-auth-refresh";

/** Margen antes del vencimiento en el que se renueva (el token dura 15 min). */
const SKEW_MS = 3 * 60 * 1000;
/** Piso entre renovaciones: protege del bucle si el servidor devolviera un `expiresAt` ya vencido. */
const MIN_INTERVAL_MS = 30_000;

/** Política de credenciales: en dev las apps viven en otros puertos ⇒ cross-origin. */
const CREDENTIALS: RequestCredentials = IS_DEV ? "include" : "same-origin";

let expiresAt: number | null = null;
let lastRefreshAt = 0;
let inflight: Promise<boolean> | null = null;
let channel: BroadcastChannel | undefined;
let timer: ReturnType<typeof setTimeout> | undefined;
let started = false;

function refreshUrl(): string {
	return IS_DEV ? getDevUrl(AUTH_DEV_PORT, REFRESH_PATH) : REFRESH_PATH;
}

function readStoredExpiry(): number | null {
	try {
		const raw = globalThis.localStorage?.getItem(EXPIRY_KEY);
		const parsed = raw ? Number(raw) : Number.NaN;
		return Number.isFinite(parsed) ? parsed : null;
	} catch {
		return null;
	}
}

function writeStoredExpiry(value: number | null): void {
	try {
		if (value === null) globalThis.localStorage?.removeItem(EXPIRY_KEY);
		else globalThis.localStorage?.setItem(EXPIRY_KEY, String(value));
	} catch {
		/* modo privado / storage bloqueado: se sigue con el valor en memoria */
	}
}

/** ¿Se sabe (y hace poco) que este origen no tiene sesión renovable? */
function isSessionKnownAbsent(): boolean {
	try {
		const raw = globalThis.localStorage?.getItem(ABSENT_KEY);
		const parsed = raw ? Number(raw) : Number.NaN;
		return Number.isFinite(parsed) && Date.now() - parsed < ABSENT_TTL_MS;
	} catch {
		return false;
	}
}

function markSessionAbsent(absent: boolean): void {
	try {
		if (absent) globalThis.localStorage?.setItem(ABSENT_KEY, String(Date.now()));
		else globalThis.localStorage?.removeItem(ABSENT_KEY);
	} catch {
		/* modo privado / storage bloqueado: se pierde el anti-avalancha, nada más */
	}
}

/** Vencimiento conocido, preferentemente el compartido con las otras pestañas del origen. */
function currentExpiry(): number | null {
	const stored = readStoredExpiry();
	if (stored !== null && (expiresAt === null || stored > expiresAt)) expiresAt = stored;
	return expiresAt;
}

function isNearExpiry(): boolean {
	const expiry = currentExpiry();
	return expiry !== null && expiry - Date.now() <= SKEW_MS;
}

/**
 * Registra el vencimiento anunciado por el servidor. `null`/`undefined` significa
 * "sin sesión": se olvida el vencimiento y se cancela la renovación programada.
 */
export function noteSessionExpiry(value: number | string | null | undefined): void {
	if (value === null || value === undefined) {
		expiresAt = null;
		writeStoredExpiry(null);
		markSessionAbsent(true);
		clearTimeout(timer);
		timer = undefined;
		return;
	}

	const parsed = typeof value === "number" ? value : Date.parse(value);
	if (!Number.isFinite(parsed)) return;

	expiresAt = parsed;
	writeStoredExpiry(parsed);
	markSessionAbsent(false);
	scheduleNext();
}

/**
 * Renueva si el token está por vencer. Es el gancho barato que corre antes de cada
 * request: sin sesión conocida o con margen de sobra no hace absolutamente nada.
 */
export async function ensureFreshSession(): Promise<void> {
	if (!isNearExpiry()) return;
	await refreshSession();
}

/**
 * Renueva la sesión. `force` la pide aunque el vencimiento no esté cerca (lo usa la
 * red de seguridad del 401, donde el vencimiento conocido puede ser mentira).
 *
 * Devuelve `false` si la sesión ya no se puede renovar: el caller decide qué hacer
 * (nunca fuerza logout desde acá).
 */
export async function refreshSession(force = false): Promise<boolean> {
	// Visitante anónimo: ya se comprobó hace poco que no hay nada que renovar.
	if (isSessionKnownAbsent()) return false;

	// Single-flight dentro de la pestaña (varios microfrontends comparten este módulo).
	if (inflight !== null) return inflight;

	inflight = (async () => {
		try {
			return await withLock(async () => {
				// Dentro del lock: si otra pestaña del origen ya renovó, no salir a la red.
				// El chequeo de "sin sesión" se repite acá porque el lock es lo único que
				// serializa las copias federadas del módulo: sin esto, las que entraron
				// al lock antes de la primera respuesta salen igual a pedir un refresh.
				if (isSessionKnownAbsent()) return false;
				if (!force && !isNearExpiry()) return true;
				if (Date.now() - lastRefreshAt < MIN_INTERVAL_MS) return true;
				return await postRefresh();
			});
		} finally {
			inflight = null;
		}
	})();

	return inflight;
}

/**
 * Serializa con las demás pestañas del mismo origen. Sin Web Locks (o si fallara)
 * se ejecuta igual: la ventana de gracia del servidor absorbe la concurrencia.
 */
async function withLock<T>(fn: () => Promise<T>): Promise<T> {
	const locks = globalThis.navigator?.locks;
	if (!locks) return fn();

	try {
		return await locks.request(LOCK_NAME, fn);
	} catch {
		return fn();
	}
}

async function postRefresh(): Promise<boolean> {
	const url = refreshUrl();

	try {
		const headers = await appendCsrfHeader("POST", url, undefined, CREDENTIALS);
		const response = await fetch(url, { method: "POST", credentials: CREDENTIALS, headers });

		if (!response.ok) {
			// 401 = el refresh token también murió. Se olvida el vencimiento para no
			// reintentar en bucle; la sesión queda como terminada.
			if (response.status === 401) noteSessionExpiry(null);
			return false;
		}

		lastRefreshAt = Date.now();
		const body = (await response.json().catch(() => ({}))) as { expiresAt?: number };
		noteSessionExpiry(body.expiresAt ?? null);
		broadcastExpiry(body.expiresAt ?? null);
		return true;
	} catch {
		// Error de red: no se toca el vencimiento, se reintenta en el próximo gancho.
		return false;
	}
}

function broadcastExpiry(value: number | null): void {
	if (typeof BroadcastChannel === "undefined") return;
	try {
		const ch = new BroadcastChannel(REFRESH_CHANNEL);
		ch.postMessage({ expiresAt: value });
		ch.close();
	} catch {
		/* ignore */
	}
}

/** Renovación programada: best-effort, porque el navegador estrangula timers en background. */
function scheduleNext(): void {
	clearTimeout(timer);
	timer = undefined;

	const expiry = currentExpiry();
	if (expiry === null) return;

	const delay = Math.max(MIN_INTERVAL_MS, expiry - Date.now() - SKEW_MS);
	timer = setTimeout(() => void refreshSession(), delay);
}

/**
 * Arranca la renovación proactiva. Idempotente: la llaman todos los microfrontends
 * que comparten esta instancia del módulo.
 */
export function startSessionRefresh(): void {
	if (started || typeof globalThis.addEventListener !== "function") return;
	started = true;

	if (typeof BroadcastChannel !== "undefined") {
		try {
			channel = new BroadcastChannel(REFRESH_CHANNEL);
			channel.onmessage = (ev: MessageEvent) => {
				const value = (ev.data as { expiresAt?: number | null })?.expiresAt;
				expiresAt = typeof value === "number" ? value : null;
				scheduleNext();
			};
		} catch {
			channel = undefined;
		}
	}

	// El timer no es confiable en pestañas de fondo (Chrome los agrupa y puede
	// congelarlos), así que al volver al foreground se comprueba el vencimiento real.
	globalThis.addEventListener("visibilitychange", () => {
		if (globalThis.document?.visibilityState === "visible") void ensureFreshSession();
	});

	scheduleNext();
}
