#!/usr/bin/env node
/**
 * rotate-master-key.mjs — cambia la master key de cifrado en reposo sin perder los archivos.
 *
 * La DEK de cada usuario se guarda **envuelta** con `ADC_STORAGE_MASTER_KEY`, y no hay llavero: la
 * plataforma desenvuelve con la master key que tenga puesta y con ninguna otra, así que cambiar la
 * variable a secas deja todas las DEK —y con ellas todos los adjuntos— ilegibles, en silencio. Este
 * script desenvuelve cada DEK con la clave vieja y la reenvuelve con la nueva. **Los objetos de S3
 * no se tocan**: siguen cifrados con la misma DEK, que es lo que hace que esto dure minutos.
 *
 *   # con la plataforma parada en TODOS los nodos y la clave nueva ya en env/secrets.env:
 *   ADC_STORAGE_MASTER_KEY_OLD=<la vieja> node scripts/rotate-master-key.mjs --dry-run
 *   ADC_STORAGE_MASTER_KEY_OLD=<la vieja> node scripts/rotate-master-key.mjs --yes
 *
 * Las claves van por entorno y nunca por argumento: un flag queda en el historial del shell y en la
 * lista de procesos de cualquiera que corra `ps`.
 *
 * Es reanudable —cada DEK se reescribe con un `updateOne` condicionado a su `keyVersion`—, pero
 * **no** admite cambiar de clave a mitad de camino: sin llavero haría falta una tercera clave para
 * los documentos de la tanda anterior, así que lo detecta y se niega.
 */

import { createCipheriv, createDecipheriv, randomBytes, timingSafeEqual } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { MongoClient } from "mongodb";

const DEK_LENGTH = 32;
const IV_LENGTH = 12;
const SCHEME = "aes-256-gcm";

/**
 * Orden de carga de `env/`, el mismo que usa el kernel (el último gana). Se replica en vez de
 * importar el cargador porque ése es TypeScript con imports `.js`, que node no resuelve.
 */
const ENV_FILES = ["identity", "build", "storage", "mail", "optionals", "network", "secrets", "host"];

const c = { reset: "[0m", bold: "[1m", dim: "[2m", red: "[31m", green: "[32m", yellow: "[33m", cyan: "[36m" };

function fail(message) {
	console.error(`${c.red}✗${c.reset} ${message}`);
	process.exit(1);
}

function repoRoot() {
	return resolve(dirname(fileURLToPath(import.meta.url)), "..");
}

/** Parseo mínimo de un `.env`: `CLAVE=valor`, comillas opcionales, `#` de comentario. */
function loadEnvFile(file) {
	if (!existsSync(file)) return;
	for (const line of readFileSync(file, "utf-8").split(/\r?\n/)) {
		const trimmed = line.trim();
		if (!trimmed || trimmed.startsWith("#")) continue;
		const eq = trimmed.indexOf("=");
		if (eq < 1) continue;
		const key = trimmed.slice(0, eq).trim();
		// Lo que ya venga del entorno gana: así se pasa la clave vieja sin tocar ningún archivo.
		if (process.env[key] !== undefined) continue;
		process.env[key] = trimmed
			.slice(eq + 1)
			.trim()
			.replace(/^(['"])(.*)\1$/s, "$2");
	}
}

function loadEnv(root) {
	for (const name of ENV_FILES) loadEnvFile(join(root, "env", `${name}.env`));
	// Compat con el despliegue que todavía no partió su `.env`.
	loadEnvFile(join(root, ".env"));
}

/** 32 bytes en hex o base64, igual que `resolveAtRestMasterKey`. Sin fallback de desarrollo: acá adivinar sería destruir. */
function parseKey(raw, label) {
	const value = raw?.trim();
	if (!value) fail(`Falta ${label}.`);
	if (/^[0-9a-fA-F]{64}$/.test(value)) return Buffer.from(value, "hex");
	const b64 = Buffer.from(value, "base64");
	if (b64.length === DEK_LENGTH) return b64;
	return fail(`${label} inválida: se esperan 32 bytes en hex (64 caracteres) o en base64.`);
}

function unwrap(wrappedKey, key) {
	const [iv, tag, data] = String(wrappedKey).split(".");
	if (!iv || !tag || !data) throw new Error("wrappedKey con formato inesperado");
	const decipher = createDecipheriv(SCHEME, key, Buffer.from(iv, "base64"));
	decipher.setAuthTag(Buffer.from(tag, "base64"));
	return Buffer.concat([decipher.update(Buffer.from(data, "base64")), decipher.final()]);
}

function wrap(dek, key) {
	const iv = randomBytes(IV_LENGTH);
	const cipher = createCipheriv(SCHEME, key, iv);
	const out = Buffer.concat([cipher.update(dek), cipher.final()]);
	return `${iv.toString("base64")}.${cipher.getAuthTag().toString("base64")}.${out.toString("base64")}`;
}

function parseArgs(argv) {
	const args = { dryRun: false, yes: false, dbs: [] };
	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		if (arg === "--dry-run") args.dryRun = true;
		else if (arg === "--yes") args.yes = true;
		else if (arg === "--help" || arg === "-h") args.help = true;
		else if (arg === "--uri") args.uri = argv[++i];
		else if (arg === "--db") args.dbs.push(argv[++i]);
		else fail(`Argumento desconocido: ${arg}`);
	}
	return args;
}

function printHelp() {
	console.log(`${c.bold}rotate-master-key${c.reset} — reenvuelve las DEK con una master key nueva.

Uso (con la plataforma PARADA en todos los nodos):
  ADC_STORAGE_MASTER_KEY_OLD=<vieja> node scripts/rotate-master-key.mjs --dry-run
  ADC_STORAGE_MASTER_KEY_OLD=<vieja> node scripts/rotate-master-key.mjs --yes

La clave NUEVA se toma de ADC_STORAGE_MASTER_KEY (normalmente ya puesta en env/secrets.env).
Las dos van por entorno y nunca por argumento: un flag queda en el historial y en 'ps'.

Opciones:
  --dry-run   Contar y comprobar que la clave vieja las abre todas, sin escribir nada.
  --yes       Ejecutar la reescritura.
  --uri <s>   URI de Mongo. Por defecto se compone de MONGO_HOST/USER/PASSWORD/OPTIONS.
  --db <n>    Rotar SÓLO esta base (repetible). Avisa cuáles quedan sin rotar: usarlo y olvidarse
              de una base es cómo esa base queda envuelta con una clave que ya nadie tiene.

Es reanudable: si se corta, volvé a correrlo con el MISMO par de claves.`);
}

/** URI compuesta de las mismas partes que usa el provider. */
function mongoUri(explicit) {
	if (explicit) return explicit;
	const host = process.env.MONGO_HOST?.trim();
	if (!host) fail("Falta `MONGO_HOST` (y no se pasó `--uri`): no hay contra qué conectar.");
	const user = process.env.MONGO_USER?.trim();
	const auth = user ? `${encodeURIComponent(user)}:${encodeURIComponent(process.env.MONGO_PASSWORD ?? "")}@` : "";
	const options = (process.env.MONGO_OPTIONS ?? "").replace(/^\?/, "").trim();
	const query = options ? `?${options}` : "";
	return `mongodb://${auth}${host}/${query}`;
}

const SYSTEM_DBS = new Set(["admin", "local", "config"]);

/**
 * Encuentra los almacenes de DEK por la **forma** de sus documentos y no por una lista de nombres:
 * cada app elige el nombre de su colección (`drive_user_keys`, `email_user_keys`, …) y un preset
 * nuevo agrega la suya sin que este script se entere. Una colección salteada queda ilegible para
 * siempre y no se nota hasta que alguien intenta abrir un archivo.
 */
async function findKeyStores(client, only) {
	const { databases } = await client.db("admin").admin().listDatabases();
	const stores = [];
	const skipped = [];
	for (const { name } of databases) {
		if (SYSTEM_DBS.has(name)) continue;
		if (only.length > 0 && !only.includes(name)) {
			skipped.push(name);
			continue;
		}
		const db = client.db(name);
		for (const info of await db.listCollections({}, { nameOnly: true }).toArray()) {
			const collection = db.collection(info.name);
			const sample = await collection.findOne({ wrappedKey: { $exists: true }, keyVersion: { $exists: true } });
			if (sample) stores.push({ db: name, name: info.name, collection });
		}
	}
	return { stores, skipped };
}

/** ¿Abre esta clave alguna DEK de esa versión? Se prueba con una y alcanza: todas las de una versión están envueltas igual. */
async function opensVersion(stores, version, key) {
	for (const store of stores) {
		const doc = await store.collection.findOne({ keyVersion: version }, { projection: { wrappedKey: 1 } });
		if (!doc) continue;
		try {
			unwrap(doc.wrappedKey, key);
			return true;
		} catch {
			return false;
		}
	}
	return false;
}

/**
 * Qué versión hay, a cuál se va, y si acaso ya está hecho. Se decide probando **cuál de las dos
 * claves abre lo que hay**, que es lo único que distingue una rotación normal de una interrumpida y
 * de una ya hecha.
 *
 * Sin llavero sólo se convierte de UNA versión a la siguiente, así que corta acá —el único momento
 * en que la clave que falta todavía se puede ir a buscar— si las versiones no son consecutivas o si
 * ninguna de las dos claves abre nada.
 */
async function planRotation(stores, oldKey, newKey) {
	const versions = new Set();
	for (const store of stores) {
		for (const v of await store.collection.distinct("keyVersion")) versions.add(Number(v));
	}
	const sorted = [...versions].sort((a, b) => a - b);
	if (sorted.length === 0) return { done: true, reason: "Las colecciones existen pero están vacías: no hay ninguna DEK." };
	if (sorted.length > 2 || (sorted.length === 2 && sorted[1] !== sorted[0] + 1)) {
		return fail(
			`Hay DEK en ${sorted.length} versiones distintas (${sorted.join(", ")}). ` +
			"Eso significa que quedaron envueltas con más de una master key vieja, y este script maneja un par de claves por corrida. " +
			"Hay que reenvolver de a una versión por vez, empezando por la más vieja."
		);
	}
	const top = sorted.at(-1);
	if (await opensVersion(stores, top, newKey)) {
		// La versión más alta ya está con la clave nueva. Si es la única, no queda nada.
		if (sorted.length === 1) return { done: true, reason: `Todas las DEK ya están envueltas con la clave nueva (versión ${top}).` };
		return { from: sorted[0], to: top };
	}
	if (!(await opensVersion(stores, top, oldKey))) {
		return fail(
			`Ninguna de las dos claves abre las DEK que hay (versión ${top}). ` +
			"La que las envolvió no está en el entorno: buscala antes de seguir. No se tocó nada."
		);
	}
	return { from: top, to: top + 1 };
}

async function rewrapStore(store, { from, to }, oldKey, newKey, dryRun) {
	const cursor = store.collection.find({ keyVersion: from }, { projection: { wrappedKey: 1, keyVersion: 1 } });
	let converted = 0;
	let failed = 0;
	for await (const doc of cursor) {
		let dek;
		try {
			dek = unwrap(doc.wrappedKey, oldKey);
		} catch {
			failed++;
			console.log(`    ${c.red}✗${c.reset} ${store.db}.${store.name}/${String(doc._id)}: la clave vieja no la abre.`);
			continue;
		}
		// Desenvolver lo recién envuelto ANTES de escribir cuesta un AES-GCM por documento y separa
		// «se rompió el cifrado» de «no se escribió».
		const rewrapped = wrap(dek, newKey);
		let verified = false;
		try {
			const roundTrip = unwrap(rewrapped, newKey);
			verified = roundTrip.length === dek.length && timingSafeEqual(roundTrip, dek);
		} catch {
			verified = false;
		}
		if (!verified) {
			failed++;
			console.log(`    ${c.red}✗${c.reset} ${store.db}.${store.name}/${String(doc._id)}: la comprobación de ida y vuelta falló. No se escribió.`);
			continue;
		}
		if (!dryRun) {
			// Condicionado a la versión de origen: dos corridas simultáneas no se pisan.
			await store.collection.updateOne({ _id: doc._id, keyVersion: from }, { $set: { wrappedKey: rewrapped, keyVersion: to } });
		}
		converted++;
	}
	return { converted, failed };
}

const NOT_COVERED = `${c.bold}Lo que esta rotación NO arregla${c.reset}
  ${c.dim}Todo lo demás que deriva de la master key usa sub-claves determinísticas, así que cambiarla
  los invalida — pero ninguno es una pérdida de datos:${c.reset}
  · Los sobres del Redis compartido (sesión, rate limit) dejan de abrir y se tratan como "no está":
    se recalculan solos. No hay nada que hacer.
  · La credencial guardada del plano de control de la red privada deja de abrir. Hay que emitir otra
    desde el panel, tab Red privada. El panel lo dice al abrirse, no falla en silencio.`;

function report({ converted, failed }, dryRun) {
	console.log("");
	if (failed > 0) {
		const done = dryRun ? "quedaron sin tocar (dry-run)" : "ya están en la versión nueva";
		console.log(
			`${c.red}${c.bold}${failed} DEK no se pudieron convertir.${c.reset} La causa casi siempre es que la clave vieja no es la que las envolvió.\n` +
			`Las que sí se pudieron ${done}. NO arranques la plataforma con la clave nueva hasta resolverlo:\n` +
			`volvé a poner la vieja en env/secrets.env y todo sigue funcionando como antes.`
		);
		process.exitCode = 1;
		return;
	}
	if (dryRun) console.log(`${c.green}${c.bold}Todas abren con la clave vieja${c.reset} (${converted} DEK). Volvé a correr con \`--yes\` para reescribirlas.\n`);
	else console.log(`${c.green}${c.bold}Listo:${c.reset} ${converted} DEK ahora están envueltas con la clave nueva.\n`);
	console.log(NOT_COVERED);
}

async function rewrapAll(stores, plan, oldKey, newKey, dryRun) {
	const totals = { converted: 0, failed: 0 };
	for (const store of stores) {
		const result = await rewrapStore(store, plan, oldKey, newKey, dryRun);
		totals.converted += result.converted;
		totals.failed += result.failed;
		const verb = dryRun ? "comprobadas" : "reenvueltas";
		const mark = result.failed === 0 ? `${c.green}✓${c.reset}` : `${c.yellow}!${c.reset}`;
		console.log(`  ${mark} ${store.db}.${store.name}: ${result.converted} ${verb}, ${result.failed} con problema`);
	}
	return totals;
}

/** Las dos claves, validadas: salir de acá con una mal leída sería reescribir con basura. */
function resolveKeys() {
	const newKey = parseKey(process.env.ADC_STORAGE_MASTER_KEY, "`ADC_STORAGE_MASTER_KEY` (la clave NUEVA)");
	const oldKey = parseKey(process.env.ADC_STORAGE_MASTER_KEY_OLD, "`ADC_STORAGE_MASTER_KEY_OLD` (la clave VIEJA)");
	if (newKey.equals(oldKey)) fail("Las dos claves son iguales: no hay nada que rotar.");
	return { newKey, oldKey };
}

async function run(args) {
	loadEnv(repoRoot());
	const { newKey, oldKey } = resolveKeys();

	console.log(`${c.bold}${c.cyan}Rotación de la master key${c.reset}`);
	if (args.dryRun) console.log(`${c.yellow}Modo dry-run: se comprueba todo y no se escribe nada.${c.reset}`);
	console.log(`${c.dim}Los objetos de S3 no se tocan: siguen cifrados con la misma DEK de cada usuario.${c.reset}\n`);

	const client = new MongoClient(mongoUri(args.uri), { serverSelectionTimeoutMS: 10_000 });
	try {
		await client.connect();
		const { stores, skipped } = await findKeyStores(client, args.dbs);
		if (skipped.length > 0) {
			// Una rotación parcial que se cree completa deja una base envuelta con una clave perdida.
			console.log(`${c.yellow}⚠ Filtrado por --db: quedan SIN rotar ${skipped.length} base(s): ${skipped.join(", ")}.${c.reset}\n`);
		}
		if (stores.length === 0) {
			console.log(`${c.yellow}No se encontró ninguna colección de DEK.${c.reset} Si esperabas encontrarlas, revisá la URI y las credenciales antes de cambiar la master key.`);
			return;
		}
		console.log(`${c.bold}Almacenes de DEK${c.reset} ${c.dim}(${stores.length})${c.reset}`);
		for (const store of stores) console.log(`  · ${store.db}.${store.name}`);
		const plan = await planRotation(stores, oldKey, newKey);
		if (plan.done) {
			console.log(`\n${c.green}${c.bold}No hay nada que hacer.${c.reset} ${plan.reason}\n`);
			console.log(NOT_COVERED);
			return;
		}
		console.log(`\n${c.bold}Versión${c.reset} ${plan.from} → ${plan.to}\n`);
		report(await rewrapAll(stores, plan, oldKey, newKey, args.dryRun), args.dryRun);
	} finally {
		await client.close().catch(() => undefined);
	}
}

const args = parseArgs(process.argv.slice(2));
if (args.help) printHelp();
else if (!args.dryRun && !args.yes) fail("Elegí `--dry-run` (contar y comprobar) o `--yes` (reescribir). Sin uno de los dos no hace nada a propósito.");
else await run(args).catch((error) => fail(error.message));
