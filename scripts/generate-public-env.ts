/**
 * Genera `src/common/utils/public-env.generated.ts` con los valores de la identidad pública del
 * despliegue, leídos del entorno.
 *
 * ⚠️ El `import` de `load-env` es obligatorio y va primero: los `ADC_PUBLIC_*` viven en
 * `env/identity.env`, que bun no autocarga, así que sin él el script generaría todo con cadena
 * vacía **sin fallar** (footer sin identidad fiscal, páginas legales en blanco).
 *
 * Existe porque los tres empaquetadores sustituyen constantes de formas distintas —y Stencil deja
 * `Env` como import en runtime—, así que un `define` por bundler no alcanza. Un módulo generado es
 * un import común y corriente y funciona igual para todos.
 *
 * El archivo está gitignorado, como `react-jsx.ts` y `components.d.ts`: un clon sin `.env` genera
 * uno con cadenas vacías y nunca hereda datos de otra persona.
 */
import "../src/utils/env/load-env.js";
import { writeFileSync } from "node:fs";
import { PUBLIC_ENV_VARS, type PublicEnvKey } from "../src/common/utils/public-env-vars.ts";

const OUTPUT = new URL("../src/common/utils/public-env.generated.ts", import.meta.url);

const entries = (Object.entries(PUBLIC_ENV_VARS) as Array<[PublicEnvKey, string]>)
	.map(([key, envVar]) => `\t${key}: ${JSON.stringify(process.env[envVar] ?? "")},`)
	.join("\n");

writeFileSync(
	OUTPUT,
	`// GENERADO por scripts/generate-public-env.ts — no editar a mano ni commitear.
// Los valores salen de las variables ADC_PUBLIC_* del entorno (ver .env.example).
import type { PublicEnvKey } from "./public-env-vars.js";

export const PUBLIC_ENV_VALUES: Record<PublicEnvKey, string> = {
${entries}
};
`,
	"utf8"
);

const configured = Object.keys(PUBLIC_ENV_VARS).filter((key) => process.env[PUBLIC_ENV_VARS[key as PublicEnvKey]]).length;
console.log(`[public-env] ${configured}/${Object.keys(PUBLIC_ENV_VARS).length} variables públicas configuradas`);
