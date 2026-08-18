/**
 * Encender, apagar y listar los contenedores de infraestructura **sin el kernel de por medio**.
 *
 * Existe para el caso en el que el panel no es una opción: apagar Redis o Mongo se lleva las
 * sesiones, así que la pantalla desde la que se volverían a encender deja de responder. Desde una
 * consola en la máquina esto es la vuelta, y no hace falta que el kernel arranque para usarlo.
 *
 * Hace lo mismo que hace el kernel al arrancar (`DockerManager.loadCommonDockerCompose`): resuelve
 * el compose por alias, crea la red compartida y corre `docker compose` con el entorno de `env/`
 * cargado — sin eso, `REDIS_PASSWORD` y compañía quedan vacías y el motor arranca sin auth.
 *
 * Uso:
 *   bun run infra ls
 *   bun run infra up redis            # o `up mongo redis`, o `up adc-redis-core`
 *   bun run infra down redis
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "dotenv";
import { ENV_GROUP_ORDER } from "../src/common/utils/env-manifest.ts";
import { composeAlias } from "../src/common/utils/infra-composes.ts";

const ROOT = path.resolve(fileURLToPath(import.meta.url), "../..");
const DOCKER_DIR = path.join(ROOT, "src", "common", "docker");
/** La misma red externa que crea el kernel: los stacks que se hablan sin pasar por el host la declaran. */
const SHARED_NETWORK = "adc-core-net";

/**
 * Carga `env/<grupo>.env` en el orden del manifiesto, **sin pisar** lo que ya venga del shell (ni lo
 * que bun autocargó del `.env` de la raíz): es la misma precedencia que aplica el kernel.
 */
function loadEnv(): void {
	for (const group of ENV_GROUP_ORDER) {
		const file = path.join(ROOT, "env", `${group}.env`);
		if (!existsSync(file)) continue;
		for (const [key, value] of Object.entries(parse(readFileSync(file)))) {
			process.env[key] ??= value;
		}
	}
}

/** Directorios de `src/common/docker`, indexados por alias corto y por nombre completo. */
function stacks(): Map<string, string> {
	const found = new Map<string, string>();
	for (const entry of readdirSync(DOCKER_DIR, { withFileTypes: true })) {
		if (!entry.isDirectory() || !existsSync(path.join(DOCKER_DIR, entry.name, "docker-compose.yml"))) continue;
		found.set(composeAlias(entry.name), entry.name);
	}
	return found;
}

function resolveStack(nameOrAlias: string): string {
	const dir = stacks().get(composeAlias(nameOrAlias));
	if (!dir) {
		console.error(`No hay ningún stack '${nameOrAlias}' en src/common/docker. Disponibles: ${[...stacks().keys()].join(", ")}`);
		process.exit(1);
	}
	return dir;
}

function docker(args: string[], cwd = ROOT): number {
	const run = spawnSync("docker", args, { cwd, stdio: "inherit", env: process.env });
	if (run.error) {
		console.error(`No se pudo ejecutar docker: ${run.error.message}`);
		process.exit(1);
	}
	return run.status ?? 1;
}

function composeArgs(dir: string): { args: string[]; cwd: string } {
	const cwd = path.join(DOCKER_DIR, dir);
	return { args: ["compose", "-f", path.join(cwd, "docker-compose.yml")], cwd };
}

function up(names: string[]): number {
	// `network create` sobre una red existente sale distinto de 0 y no importa: lo que importa es que
	// exista antes del `up`, porque los composes que la comparten la declaran `external`.
	spawnSync("docker", ["network", "create", SHARED_NETWORK], { stdio: "ignore" });
	let failed = 0;
	for (const name of names) {
		const { args, cwd } = composeArgs(resolveStack(name));
		console.log(`\n▶ levantando ${composeAlias(name)}...`);
		if (docker([...args, "up", "-d"], cwd) !== 0) failed++;
	}
	return failed;
}

function down(names: string[]): number {
	let failed = 0;
	for (const name of names) {
		const { args, cwd } = composeArgs(resolveStack(name));
		console.log(`\n▼ bajando ${composeAlias(name)}...`);
		// La misma gracia que usa el panel: `mongod` cierra sus archivos con tiempo y eso es lo que
		// evita tener que recuperar el journal.
		if (docker([...args, "down", "--timeout", "60"], cwd) !== 0) failed++;
	}
	return failed;
}

function ls(): void {
	for (const [alias, dir] of stacks()) {
		const { args, cwd } = composeArgs(dir);
		const ps = spawnSync("docker", [...args, "ps", "--format", "{{.Name}} {{.State}} {{.Status}}"], { cwd, encoding: "utf8", env: process.env });
		const state = (ps.stdout ?? "").trim() || "(apagado)";
		console.log(`${alias.padEnd(12)} ${dir.padEnd(22)} ${state.replaceAll("\n", "; ")}`);
	}
}

loadEnv();
const [action, ...names] = process.argv.slice(2);

if (action === "ls") {
	ls();
} else if ((action === "up" || action === "down") && names.length > 0) {
	process.exit(action === "up" ? up(names) : down(names));
} else {
	console.error("Uso: bun run infra <ls | up <stack...> | down <stack...>>   (stack = alias `redis` o directorio `adc-redis-core`)");
	process.exit(1);
}
