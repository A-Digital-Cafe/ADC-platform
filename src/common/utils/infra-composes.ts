/**
 * Catálogo de los composes de infraestructura de `src/common/docker/`, **sin tocar el entorno**.
 *
 * Vive aparte de `cluster-env.ts` porque lo importan también los paneles (React): ahí `process.env`
 * no existe y arrastrar el resolutor de rol/variables al bundle sería traer código de nodo al
 * navegador. Acá sólo hay datos y funciones puras; quién levanta qué lo sigue decidiendo
 * `shouldRunInfraCompose`.
 */

/**
 * Normaliza el nombre de un directorio de `src/common/docker` a su alias corto
 * (`adc-mongo-core` → `mongo`), para que `ADC_INFRA_COMPOSE=mongo,redis` sea legible y no obligue a
 * escribir los nombres completos.
 */
export function composeAlias(dirName: string): string {
	return dirName.replace(/^adc-/, "").replace(/-core$/, "").toLowerCase();
}

/**
 * Motores sin los que la plataforma **no puede autenticar a nadie**, y por eso apagarlos deja al
 * panel afuera: quien los apaga pierde la pantalla desde la que volvería a encenderlos.
 *
 * No es "importante": es la propiedad de que el error se cierra sobre sí mismo. Un Garage caído
 * rompe los archivos y se arregla desde el panel; un Redis caído rompe las sesiones, así que el
 * panel deja de existir como camino de vuelta y sólo queda una consola en la máquina.
 */
const CRITICAL_COMPOSES: ReadonlyMap<string, string> = new Map([
	["mongo", "guarda las identidades, los roles y el estado de los módulos: sin Mongo no hay con qué validar un login"],
	["redis", "guarda las sesiones, los topes de rate y los leases de líder: sin Redis se cae la sesión de este mismo panel"],
]);

/** Qué se rompe si este stack no está, o `null` si perderlo no deja al panel sin camino de vuelta. */
export function criticalComposeReason(nameOrAlias: string): string | null {
	return CRITICAL_COMPOSES.get(composeAlias(nameOrAlias)) ?? null;
}

/** El comando que vuelve a levantar el stack desde una consola en la máquina, sin panel de por medio. */
export function infraRecoveryCommand(nameOrAlias: string): string {
	return `bun run infra up ${composeAlias(nameOrAlias)}`;
}

/**
 * ¿Levanta este alias una selección de composes (`"*"`, `"mongo,redis"`, `""`, `null`)?
 *
 * **Sólo vale para los críticos**: da por sentado que el alias no es opt-in (`netbird`,
 * `mongo-shard`) ni exclusivo del primario, que son las dos excepciones que resuelve
 * `shouldRunInfraCompose` antes de mirar la lista. Con `null` gana el entorno del nodo, y ahí un
 * stack no opt-in se levanta salvo que la variable lo excluya — lo que no se puede leer desde otro
 * proceso, así que se asume cubierto y el aviso queda para el nodo que lo aplica.
 */
export function selectionCoversCompose(nameOrAlias: string, selection: string | null | undefined): boolean {
	if (selection === null || selection === undefined) return true;
	const alias = composeAlias(nameOrAlias);
	const tokens = selection
		.split(",")
		.map((t) => t.trim())
		.filter(Boolean);
	if (tokens.includes("*")) return true;
	return tokens.some((token) => composeAlias(token) === alias);
}

/** Críticos que `before` levantaba y `after` deja de levantar: los que el próximo arranque no repone. */
export function criticalComposesDropped(before: string | null | undefined, after: string | null | undefined): string[] {
	return [...CRITICAL_COMPOSES.keys()].filter((alias) => selectionCoversCompose(alias, before) && !selectionCoversCompose(alias, after));
}

/**
 * La misma selección, garantizando que incluya el alias. `null` y `*` se devuelven intactos: los dos
 * ya lo cubren, y reescribirlos como lista congelaría el resto de la topología sin que nadie lo pida.
 */
export function selectionWithCompose(selection: string | null | undefined, nameOrAlias: string): string | null | undefined {
	if (selectionCoversCompose(nameOrAlias, selection)) return selection;
	const tokens = (selection ?? "")
		.split(",")
		.map((t) => t.trim())
		.filter(Boolean);
	tokens.push(composeAlias(nameOrAlias));
	return tokens.join(",");
}
