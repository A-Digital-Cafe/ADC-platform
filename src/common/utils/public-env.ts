export { PUBLIC_ENV_VARS, type PublicEnvKey } from "./public-env-vars.js";

import type { PublicEnvKey } from "./public-env-vars.js";
import { PUBLIC_ENV_VALUES } from "./public-env.generated.js";

/**
 * @public Valor de una variable pública del despliegue, o cadena vacía si no está configurada.
 * Ver `public-env-vars.ts` para la lista y el porqué.
 *
 * Sirve igual en apps y en la UI library porque no depende del empaquetador: lee un módulo que se
 * genera antes del build (`scripts/generate-public-env.ts`). Se intentó primero con los `define`
 * de rspack/vite y con el `env` de Stencil, y ninguno sustituye igual — Stencil deja `Env` como
 * import en runtime y el valor termina en `undefined` sin avisar.
 */
export function publicEnv(key: PublicEnvKey): string {
	return PUBLIC_ENV_VALUES[key] ?? "";
}

/** URL de la política de seguridad publicada en el repositorio, o vacío si no hay repo configurado. */
export function securityPolicyUrl(): string {
	const repo = publicEnv("sourceRepoUrl");
	return repo ? `${repo.replace(/\/+$/, "")}/blob/main/.github/SECURITY.md` : "";
}
