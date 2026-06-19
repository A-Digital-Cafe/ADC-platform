/**
 * Cliente de disponibilidad de módulos. Consulta el endpoint público
 * `GET /api/modules/availability` (expuesto por el preset `adc-modules-manager`)
 * para que shells/launchers muestren un placeholder de "no disponible" en vez de
 * cargar una app deshabilitada. Degrada a "todo disponible" ante cualquier fallo.
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

const EMPTY: AvailabilityResponse = { disabled: {} };
let cache: Promise<AvailabilityResponse> | null = null;

/**
 * Base del gateway del kernel. En dev las apps corren en su propio puerto rspack y
 * sólo proxean `/api/i18n` al kernel, así que la disponibilidad se pide al kernel
 * (:3000) de forma absoluta (el CORS de dev permite localhost). En prod es relativo
 * (misma origin que sirve el gateway).
 */
function kernelApiBase(): string {
	return IS_DEV ? getDevUrl(3000) : "";
}

/** Obtiene (y cachea) el estado de disponibilidad. `force` re-consulta. */
export function fetchModuleAvailability(force = false): Promise<AvailabilityResponse> {
	if (!cache || force) {
		cache = fetch(`${kernelApiBase()}/api/modules/availability`, { credentials: "include" })
			.then((r) => (r.ok ? (r.json() as Promise<AvailabilityResponse>) : EMPTY))
			.then((data) => ({ disabled: data?.disabled ?? {} }))
			.catch(() => EMPTY);
	}
	return cache;
}

/** Devuelve la info de mantenimiento si la app (por nombre base) está deshabilitada. */
export async function isAppUnavailable(appBaseName: string): Promise<AppAvailability | null> {
	const { disabled } = await fetchModuleAvailability();
	return disabled[appBaseName] ?? null;
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
