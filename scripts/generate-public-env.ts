/**
 * Genera `src/common/utils/public-env.generated.ts` con los valores de la identidad pública del
 * despliegue, leídos del entorno (bun carga `.env` solo).
 *
 * Existe porque los tres empaquetadores del proyecto sustituyen constantes de formas distintas
 * —y Stencil directamente deja `Env` como import en runtime—, así que un `define` por bundler no
 * alcanza. Un módulo generado lo resuelve igual para todos: es un import común y corriente.
 *
 * El archivo está gitignorado, como `react-jsx.ts` y `components.d.ts`: un clon sin `.env` genera
 * uno con cadenas vacías y nunca hereda datos de otra persona.
 */
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
