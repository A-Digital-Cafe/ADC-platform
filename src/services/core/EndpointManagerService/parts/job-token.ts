import { createAtRestSealer } from "@common/utils/at-rest-envelope.ts";
import type { ILogger } from "../../../../interfaces/utils/ILogger.d.ts";

/**
 * Cifrado en reposo del token de sesión de un job encolado (`job-token:<jobId>` en Redis).
 *
 * Por qué existe: un endpoint `enqueue: true` responde 202 en el acto y difiere la ejecución
 * —y la autorización— al consumidor, que necesita el token original para re-verificar la
 * sesión y para que el handler haga sus chequeos de permisos. Es una sesión viva en un Redis
 * sin auth, así que va sellada. Nunca se acepta un valor sin sellar como fallback (sería una
 * vía de degradación permanente): lo que no abre degrada a "sin token" y falla por permisos.
 */

/** Etiqueta de separación de dominio. Cambiarla invalida los tokens de jobs en vuelo, nada más. */
const jobTokenSeal = createAtRestSealer("adc:job-token");

/** Valor a guardar en `job-token:<jobId>`. */
export function sealJobToken(token: string, logger?: ILogger): string {
	return jobTokenSeal.seal(token, logger);
}

/**
 * Abre lo guardado en `job-token:<jobId>`, o `null` si no se puede ("procesar sin token" →
 * el handler rechaza por permisos). El sellador loguea el motivo; sin ese log esto se ve
 * sólo como jobs que fallan con 401.
 */
export function openJobToken(sealed: string, logger?: ILogger): string | null {
	return jobTokenSeal.open(sealed, logger);
}
