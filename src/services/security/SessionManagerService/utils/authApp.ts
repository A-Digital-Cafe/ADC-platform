/**
 * Base absoluta del microfront `adc-auth` (mismo criterio que `errorRedirect.ts`).
 *
 * Los redirects que lo apuntan salen del host de la API (dev: localhost:3000), que no sirve el SPA
 * de cuentas: tienen que ser absolutos o el navegador los resuelve contra el origen equivocado.
 */
const IS_DEV = process.env.NODE_ENV !== "production";

export const AUTH_APP_BASE = IS_DEV ? "http://localhost:3012" : "https://auth.adigitalcafe.com";
