/**
 * Qué cuenta como "producción real" para la plataforma: cookies `Secure`, HSTS, CSP en enforce,
 * CSRF y KEK desde `ADC_STORAGE_MASTER_KEY`.
 *
 * Fail-closed a propósito: `NODE_ENV=production` alcanza y sólo un `ADC_LOCAL_PROD=true`
 * deliberado degrada. Olvidarse de la variable endurece, no ablanda.
 *
 * Es una de las excepciones documentadas de `process.env`: son banderas del proceso, no
 * configuración de un módulo.
 */
export function isRealProduction(): boolean {
	return process.env.NODE_ENV === "production" && !isLocalProdRun();
}

/**
 * `bun run start:prodtests` ejercita los caminos de producción en la máquina del desarrollador.
 * Es la única razón legítima para correr con `NODE_ENV=production` y seguridad degradada.
 */
function isLocalProdRun(): boolean {
	return process.env.NODE_ENV === "production" && process.env.ADC_LOCAL_PROD === "true";
}

/** Perfil de seguridad resuelto: lo que el kernel imprime al arrancar. */
export interface SecurityProfile {
	name: "development" | "local-prod" | "production";
	/** Qué prendió/apagó el perfil, para que el banner no obligue a leer el código. */
	effects: string;
	/** `true` cuando corre con `NODE_ENV=production` pero seguridad degradada a propósito. */
	degraded: boolean;
}

/**
 * Nombra el perfil de seguridad vigente para el banner de arranque; no decide nada
 * ({@link isRealProduction} sigue siendo la fuente).
 */
export function resolveSecurityProfile(): SecurityProfile {
	if (process.env.NODE_ENV !== "production") {
		return { name: "development", effects: "cookies=insecure hsts=off csp=report-only kek=dev-derived", degraded: false };
	}
	if (isLocalProdRun()) {
		return {
			name: "local-prod",
			effects: "cookies=insecure hsts=off csp=report-only kek=dev-derived (ADC_LOCAL_PROD=true)",
			degraded: true,
		};
	}
	return { name: "production", effects: "cookies=Secure hsts=on csp=enforce kek=ADC_STORAGE_MASTER_KEY", degraded: false };
}
