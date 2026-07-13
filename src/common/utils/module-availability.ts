/**
 * Cliente de estado de plataforma (mantenimiento + banners). Prefiere el indicador
 * inyectado por el kernel en prod (`window.__ADC_PLATFORM__`, CERO fetch); si no está
 * (dev), lo pide UNA vez a `GET /api/modules/platform` (cacheable) y lo cachea en
 * `window`, compartido con `adc-banner-host`. Degrada a "todo disponible" ante fallos.
 *
 * Contrato de window (espejo en la UI library / inyector del preset):
 *   - `window.__ADC_PLATFORM__`         estado ya resuelto (lo setea el inyector o el fetch).
 *   - `window.__ADC_PLATFORM_PROMISE__` fetch en vuelo, compartido (evita N pedidos por página).
 *   - `window.__ADC_APP__`              nombre base de la app actual (para filtrar banners).
 *
 * Framework-agnóstico (sólo `fetch`): usable desde cualquier app (React/Vue/etc).
 */

import { getUrl, getDevUrl, IS_DEV, isPrivateHost } from "./url-utils.js";

export interface AppAvailability {
	messageKey?: string;
	since?: number;
}

export interface AvailabilityResponse {
	/** Apps deshabilitadas, indexadas por nombre base de la app (carpeta). */
	disabled: Record<string, AppAvailability>;
}

interface PlatformBanner {
	bannerId: string;
	scope: "app" | "global";
	appName?: string | null;
	message: string;
	type: "warn" | "danger" | "success";
	from?: string | null;
	until?: string | null;
}

export interface PlatformState {
	disabled: Record<string, AppAvailability>;
	/** Apps caídas (nombres base): front caído o algún service de su grupo amigable caído. */
	down?: string[];
	banners: PlatformBanner[];
}

interface PlatformWindow {
	__ADC_PLATFORM__?: PlatformState;
	__ADC_PLATFORM_PROMISE__?: Promise<PlatformState>;
	__ADC_APP__?: string;
}

function platformWindow(): PlatformWindow {
	return globalThis as unknown as PlatformWindow;
}

/** Mensajes predefinidos (espejo de MAINTENANCE_MESSAGES en el core). */
export const MAINTENANCE_MESSAGES: Record<string, string> = {
	unavailable: "Esta aplicación no está disponible temporalmente.",
	updating:
		"Estamos trabajando en una actualización para esta aplicación. Actualizá este sitio más tarde para continuar en donde estabas.",
	repairs: "Estamos realizando reparaciones en esta aplicación. Volvé a intentarlo en unos minutos.",
};

export function maintenanceMessage(messageKey?: string): string {
	if (!messageKey) return MAINTENANCE_MESSAGES.unavailable;
	return MAINTENANCE_MESSAGES[messageKey] ?? MAINTENANCE_MESSAGES.unavailable;
}

const EMPTY_PLATFORM: PlatformState = { disabled: {}, banners: [] };

/**
 * Base del gateway del kernel. En dev las apps corren en su propio puerto rspack y
 * sólo proxean `/api/i18n` al kernel, así que el estado se pide al kernel (:3000) de
 * forma absoluta (el CORS de dev permite localhost). En prod es relativo (misma origin).
 */
function kernelApiBase(): string {
	return IS_DEV ? getDevUrl(3000) : "";
}

/**
 * Estado de plataforma: lee el global inyectado por el kernel (prod, 0 fetch) o lo pide
 * UNA vez (dev), cacheándolo en `window` para compartirlo con `adc-banner-host`. `force`
 * re-consulta sin cache (usado al volver de mantenimiento).
 */
export function loadPlatformState(force = false): Promise<PlatformState> {
	const win = platformWindow();
	if (!force && win.__ADC_PLATFORM__) return Promise.resolve(win.__ADC_PLATFORM__);
	if (!force && win.__ADC_PLATFORM_PROMISE__) return win.__ADC_PLATFORM_PROMISE__;
	const p = fetch(`${kernelApiBase()}/api/modules/platform`, { credentials: "include" })
		.then((r) => (r.ok ? (r.json() as Promise<PlatformState>) : EMPTY_PLATFORM))
		.then((d) => {
			const state: PlatformState = { disabled: d?.disabled ?? {}, down: d?.down ?? [], banners: d?.banners ?? [] };
			win.__ADC_PLATFORM__ = state;
			return state;
		})
		.catch(() => EMPTY_PLATFORM);
	win.__ADC_PLATFORM_PROMISE__ = p;
	return p;
}

/** Compat: estado de disponibilidad (apps deshabilitadas) derivado del estado de plataforma. */
export function fetchModuleAvailability(force = false): Promise<AvailabilityResponse> {
	return loadPlatformState(force).then((s) => ({ disabled: s.disabled }));
}

/** Devuelve la info de mantenimiento si la app (por nombre base) está deshabilitada. */
export async function isAppUnavailable(appBaseName: string): Promise<AppAvailability | null> {
	const { disabled } = await fetchModuleAvailability();
	return disabled[appBaseName] ?? null;
}

/**
 * Apps NO disponibles (nombres base): deshabilitadas manualmente (mantenimiento) ∪
 * caídas (`down`). Para ocultar sus botones/cards en menús (apps-menu, adc-home).
 * Degrada a set vacío (mostrar todo) si el estado de plataforma no está disponible.
 */
export async function getUnavailableApps(): Promise<Set<string>> {
	const state = await loadPlatformState();
	return new Set([...Object.keys(state.disabled), ...(state.down ?? [])]);
}

/** Dev port y host de producción de la app de errores (adc-error). */
const ERROR_APP_DEVPORT = 3026;
const ERROR_APP_PROD_HOST = "error.adigitalcafe.com";

/**
 * Gate de mantenimiento para el bootstrap de una app (main.tsx). Si la app (por
 * nombre base) está deshabilitada en el modules-manager, redirige a la página de
 * mantenimiento de adc-error (`/maintenance`) y devuelve `true` — el caller debe
 * abortar el montaje. Funciona igual en dev (puerto de adc-error) y prod
 * (subdominio `error`). Si no está deshabilitada, devuelve `false` (montar normal).
 */
export async function redirectIfUnderMaintenance(appBaseName: string): Promise<boolean> {
	// Publica la app actual para que `adc-banner-host` filtre los banners de app.
	platformWindow().__ADC_APP__ = appBaseName;
	const info = await isAppUnavailable(appBaseName);
	if (!info) return false;
	const params = new URLSearchParams({ app: appBaseName });
	if (info.messageKey) params.set("reason", info.messageKey);
	// Guardamos la URL original para que la página de mantenimiento pueda devolver
	// al usuario a la app (mismo destino) cuando vuelva a estar disponible.
	const from = globalThis.location?.href;
	if (from) params.set("from", from);
	const target = getUrl(ERROR_APP_DEVPORT, ERROR_APP_PROD_HOST, `/maintenance?${params.toString()}`);
	globalThis.location?.replace(target);
	return true;
}

/** Dominio registrable (últimas dos labels) de un hostname. */
function registrableDomain(hostname: string): string {
	return hostname.split(".").slice(-2).join(".");
}

/**
 * Valida que una return-URL apunte a la misma plataforma para evitar open-redirects:
 * mismo host, o un host privado/LAN en dev, o un subdominio del mismo dominio
 * registrable en prod (ej: `drive.adigitalcafe.com` desde `error.adigitalcafe.com`).
 */
function isSafeReturnUrl(raw: string): boolean {
	try {
		const url = new URL(raw, globalThis.location?.href);
		if (url.protocol !== "http:" && url.protocol !== "https:") return false;
		const current = globalThis.location?.hostname ?? "";
		if (url.hostname === current) return true;
		if (isPrivateHost(url.hostname) && isPrivateHost(current)) return true;
		return registrableDomain(url.hostname) === registrableDomain(current);
	} catch {
		return false;
	}
}

/**
 * Para la página de mantenimiento: re-consulta disponibilidad (sin cache) de la app
 * y, si ya volvió a estar disponible, navega a la return-URL original. Devuelve
 * `true` si redirigió (el caller puede seguir mostrando el placeholder mientras tanto).
 */
export async function returnToAppIfAvailable(appBaseName: string, returnUrl: string | null | undefined): Promise<boolean> {
	if (!appBaseName || !returnUrl || !isSafeReturnUrl(returnUrl)) return false;
	const { disabled } = await fetchModuleAvailability(true);
	if (disabled[appBaseName]) return false; // sigue deshabilitada
	globalThis.location?.replace(returnUrl);
	return true;
}
