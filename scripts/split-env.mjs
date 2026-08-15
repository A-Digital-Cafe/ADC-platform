/**
 * Parte el `.env` / `.env.example` monolíticos de la raíz en `env/<grupo>.env` + su `.example`,
 * según el manifiesto de `src/common/utils/env-manifest.ts`.
 *
 * **Idempotente**: relee lo que ya hay en `env/` y hace merge por clave, así que se puede correr
 * después de haber editado los archivos partidos. Cada bloque de comentarios inmediatamente anterior
 * a una clave viaja con ella a su archivo nuevo: el `.env.example` de la raíz es documentación real.
 *
 *   bun scripts/split-env.mjs [--dry-run] [--prune]
 *
 * `--dry-run` imprime el destino de cada variable sin escribir. `--prune` renombra el `.env` viejo a
 * `.env.pre-split.bak` (sin él se deja en su lugar, y el cargador avisa de que está tapando).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync, chmodSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { ENV_GROUP_ORDER, groupOf } from "../src/common/utils/env-manifest.ts";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ENV_DIR = resolve(ROOT, "env");
const DRY_RUN = process.argv.includes("--dry-run");
const PRUNE = process.argv.includes("--prune");

/** Grupo donde caen las variables que el manifiesto no conoce, con una marca para revisarlas. */
const FALLBACK_GROUP = "optionals";

/** Los que llevan credenciales: se escriben 0600 y su `.example` va con los valores vacíos. */
const RESTRICTED_GROUPS = new Set(["secrets", "host"]);

const DECL_RE = /^(#\s*)?([A-Z_][A-Z0-9_]*)=(.*)$/;

/**
 * Parsea un archivo de entorno conservando, para cada clave, el bloque de comentarios que la
 * precede. Un bloque termina en la primera línea en blanco, así que los encabezados de sección
 * separados por una línea vacía no se pegan a la variable siguiente.
 *
 * **Dos pasadas**, porque el `.env.example` documenta usos con líneas de ejemplo indentadas dentro
 * del bloque de comentarios:
 *
 *     #   ADC_INFRA_COMPOSE=mongo,redis,garage      ← ejemplo, no una declaración
 *     ADC_INFRA_COMPOSE=*                           ← la declaración de verdad
 *
 * La primera pasada junta los nombres realmente declarados; en la segunda, un `# VAR=` cuyo `VAR` ya
 * aparece activo en el mismo archivo se trata como comentario. Un `# BOOT_MAX_PARALLEL=4` sin
 * declaración activa sí sigue siendo una variable comentada.
 */
function parseWithComments(text) {
	const lines = text.split(/\r?\n/).map((l) => l.trimEnd());

	const activeNames = new Set();
	for (const line of lines) {
		const match = DECL_RE.exec(line.trim());
		if (match && !match[1]) activeNames.add(match[2]);
	}

	const entries = [];
	let comments = [];
	for (const line of lines) {
		if (line.trim() === "") {
			comments = [];
			continue;
		}
		const match = DECL_RE.exec(line.trim());
		const isExampleLine = match?.[1] && activeNames.has(match[2]);
		if (match && !isExampleLine) {
			entries.push({ name: match[2], value: match[3], commentedOut: !!match[1], comments: comments.slice() });
			comments = [];
			continue;
		}
		if (line.trimStart().startsWith("#")) comments.push(line.trimStart());
	}
	return entries;
}

function readIfExists(path) {
	return existsSync(path) ? readFileSync(path, "utf8") : null;
}

/** Serializa un valor como lo hace el resto del proyecto: se cita sólo si hace falta. */
function serialize(value) {
	if (value === "") return "";
	return /[\s#"'=]/.test(value) && !/^".*"$/.test(value) ? JSON.stringify(value) : value;
}

/**
 * Renderiza un archivo del grupo. `kind: "example"` usa **sólo** los valores del `.env.example` de
 * la raíz: los `.example` se versionan, así que copiarles los valores reales publicaría el nombre
 * legal, el CUIT y el dominio de correo del despliegue en el repo.
 */
function renderGroup(group, entries, { kind }) {
	const isExample = kind === "example";
	const header = [
		`# ── env/${group} ${"─".repeat(Math.max(0, 60 - group.length))}`,
		isExample
			? `# Plantilla versionada: valores de ejemplo, nunca los de un despliegue real.`
			: `# Generado por scripts/split-env.mjs desde el .env de la raíz. Editable a mano.`,
		`# Qué va en cada archivo: env/README.md`,
		"",
	];
	const body = [];
	for (const entry of entries) {
		for (const comment of entry.comments) body.push(comment);
		// En el archivo real, una variable que el operador NUNCA puso queda **comentada**, mostrando
		// su valor de ejemplo: activarla sería configurar sola algo que nadie configuró (promover
		// `ADC_PUBLIC_OPERATOR_TAX_STATUS=Monotributista` publica una condición fiscal no declarada).
		const useReal = !isExample && entry.hasReal;
		const raw = useReal ? entry.realValue : entry.exampleValue;
		let commented;
		if (useReal) commented = entry.realCommentedOut;
		else if (isExample) commented = entry.exampleCommentedOut;
		else commented = true;
		body.push(`${commented ? "# " : ""}${entry.name}=${serialize(raw ?? "")}`, "");
	}
	return [...header, ...body].join("\n").replace(/\n{3,}/g, "\n\n");
}

// ── Recolección ──────────────────────────────────────────────────────────────────────────────────

const realText = readIfExists(resolve(ROOT, ".env"));
const exampleText = readIfExists(resolve(ROOT, ".env.example"));

if (!realText && !exampleText) {
	console.error("No hay .env ni .env.example en la raíz: nada que partir.");
	process.exit(1);
}

// Dos vías de valor que NO se mezclan: la de ejemplo (versionada) y la real (gitignoreada). El
// `.example` de la raíz aporta además el orden y los comentarios.
const merged = new Map();
const unknown = [];

function upsert(name, patch) {
	const previous = merged.get(name);
	if (!previous && !groupOf(name) && !unknown.includes(name)) unknown.push(name);
	merged.set(name, {
		name,
		group: groupOf(name) ?? previous?.group ?? FALLBACK_GROUP,
		exampleValue: previous?.exampleValue,
		exampleCommentedOut: previous?.exampleCommentedOut ?? false,
		realValue: previous?.realValue,
		realCommentedOut: previous?.realCommentedOut ?? false,
		hasReal: previous?.hasReal ?? false,
		comments: previous?.comments ?? [],
		...patch,
	});
}

// 1. El `.env.example` de la raíz: orden, comentarios y valores de ejemplo.
for (const entry of parseWithComments(exampleText ?? "")) {
	upsert(entry.name, {
		exampleValue: entry.value,
		exampleCommentedOut: entry.commentedOut,
		comments: entry.comments,
	});
}

// 2. El `.env` real: sólo valores. Sus comentarios no pisan a los del `.example`, que son mejores.
for (const entry of parseWithComments(realText ?? "")) {
	const previous = merged.get(entry.name);
	upsert(entry.name, {
		realValue: entry.value,
		realCommentedOut: entry.commentedOut,
		hasReal: true,
		comments: previous?.comments?.length ? previous.comments : entry.comments,
	});
}

// 3. Lo que ya esté en `env/*.env` gana como valor real: es lo que hace idempotente al script.
for (const group of ENV_GROUP_ORDER) {
	const text = readIfExists(resolve(ENV_DIR, `${group}.env`));
	if (!text) continue;
	for (const entry of parseWithComments(text)) {
		const previous = merged.get(entry.name);
		upsert(entry.name, {
			realValue: entry.value,
			realCommentedOut: entry.commentedOut,
			hasReal: true,
			comments: previous?.comments?.length ? previous.comments : entry.comments,
		});
	}
}

// 4. Y lo que ya esté en un `env/*.env.example` conserva su valor de ejemplo, para que regenerar
//    no borre una plantilla escrita a mano.
for (const group of ENV_GROUP_ORDER) {
	const text = readIfExists(resolve(ENV_DIR, `${group}.env.example`));
	if (!text) continue;
	for (const entry of parseWithComments(text)) {
		if (merged.get(entry.name)?.exampleValue !== undefined) continue;
		upsert(entry.name, { exampleValue: entry.value, exampleCommentedOut: entry.commentedOut });
	}
}

// ── Reparto ──────────────────────────────────────────────────────────────────────────────────────

const byGroup = new Map(ENV_GROUP_ORDER.map((g) => [g, []]));
for (const entry of merged.values()) byGroup.get(entry.group).push(entry);

if (DRY_RUN) {
	for (const group of ENV_GROUP_ORDER) {
		const entries = byGroup.get(group);
		console.log(`\nenv/${group}.env  (${entries.length})`);
		for (const e of entries) console.log(`  ${e.hasReal && !e.realCommentedOut ? "•" : "·"} ${e.name}`);
	}
	if (unknown.length) console.log(`\n⚠ Sin entrada en el manifiesto (van a ${FALLBACK_GROUP}): ${unknown.join(", ")}`);
	console.log(`\n(dry-run: no se escribió nada)`);
	process.exit(0);
}

if (!existsSync(ENV_DIR)) mkdirSync(ENV_DIR, { recursive: true });

for (const group of ENV_GROUP_ORDER) {
	const entries = byGroup.get(group);
	if (entries.length === 0) continue;

	const envPath = resolve(ENV_DIR, `${group}.env`);
	writeFileSync(envPath, renderGroup(group, entries, { kind: "real" }), "utf8");
	if (RESTRICTED_GROUPS.has(group)) chmodSync(envPath, 0o600);

	// El `.example` se regenera siempre: es documentación versionada y tiene que reflejar el
	// manifiesto.
	const examplePath = resolve(ENV_DIR, `${group}.env.example`);
	writeFileSync(examplePath, renderGroup(group, entries, { kind: "example" }), "utf8");

	console.log(`env/${group}.env  ← ${entries.length} variable(s)${RESTRICTED_GROUPS.has(group) ? " [0600]" : ""}`);
}

if (unknown.length > 0) {
	console.log(`\n⚠ Sin entrada en el manifiesto, fueron a ${FALLBACK_GROUP}: ${unknown.join(", ")}`);
	console.log(`  Agregarlas a src/common/utils/env-manifest.ts o borrarlas con 'configure' si ya no se usan.`);
}

if (PRUNE && existsSync(resolve(ROOT, ".env"))) {
	renameSync(resolve(ROOT, ".env"), resolve(ROOT, ".env.pre-split.bak"));
	console.log(`\n.env → .env.pre-split.bak (el original queda como respaldo)`);
} else if (existsSync(resolve(ROOT, ".env"))) {
	console.log(`\n⚠ El .env de la raíz sigue ahí y le GANA a env/. Correr con --prune cuando esté verificado.`);
}
