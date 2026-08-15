// Mutex entre sesiones para el entorno de desarrollo: dos agentes en paralelo
// sobre el MISMO repo comparten kernel, puertos y un único puerto de CDP, así que
// sin coordinación el `stop` de uno mata las pruebas del otro y dos `up` dejan dos
// kernels peleando por :3000.
//
// La regla es **encolar, no pisar**: cada comando toma el lock y espera su turno.
// Un lock cuyo dueño ya no existe se toma sin preguntar.
//
// `ADC_DRIVER_SESSION` agrega identidad, porque el lock serializa pero no
// distingue "mi propio stop" del de otro agente (cada llamada de shell es un pid
// nuevo). Sin la variable, sólo serializa.
import { mkdirSync, readFileSync, writeFileSync, unlinkSync, openSync, closeSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";

const ROOT = fileURLToPath(new URL("../../../../", import.meta.url));
const LOCK_DIR = path.join(ROOT, "temp");
const LOCK_FILE = path.join(LOCK_DIR, ".adc-driver.lock");
const ACTIVITY_FILE = path.join(LOCK_DIR, ".adc-driver-activity.json");

/** Cuánto se espera un turno por defecto antes de rendirse. */
const DEFAULT_WAIT_MS = 15 * 60_000;
/** Cada cuánto se reintenta tomar el lock. */
const POLL_MS = 1_000;
/**
 * Un lock sin refrescar por más de esto se considera abandonado aunque el pid
 * siga vivo (un proceso colgado no puede secuestrar el repo indefinidamente).
 */
const STALE_MS = 30 * 60_000;
/** Cada cuánto el dueño refresca su lock mientras trabaja. */
const HEARTBEAT_MS = 5_000;

/** Quién soy. Sin `ADC_DRIVER_SESSION` no hay identidad estable entre llamadas. */
export function sessionId() {
	return process.env.ADC_DRIVER_SESSION || null;
}

function readJson(file) {
	try {
		return JSON.parse(readFileSync(file, "utf8"));
	} catch {
		return null;
	}
}

function alive(pid) {
	if (!pid) return false;
	try {
		// Señal 0: no manda nada, sólo comprueba que el proceso exista.
		process.kill(pid, 0);
		return true;
	} catch (e) {
		// EPERM = existe pero es de otro usuario; sigue vivo.
		return e.code === "EPERM";
	}
}

/** Dueño actual del lock, o `null` si está libre (o quedó huérfano). */
export function lockHolder() {
	const held = readJson(LOCK_FILE);
	if (!held) return null;
	const fresh = Date.now() - (held.beatAt ?? held.startedAt ?? 0) < STALE_MS;
	return alive(held.pid) && fresh ? held : null;
}

/** Última actividad registrada (para que `stop` sepa si hay alguien trabajando). */
export function lastActivity() {
	return readJson(ACTIVITY_FILE);
}

function writeActivity(command) {
	try {
		mkdirSync(LOCK_DIR, { recursive: true });
		writeFileSync(ACTIVITY_FILE, JSON.stringify({ command, session: sessionId(), pid: process.pid, at: Date.now() }));
	} catch {
		/* la actividad es informativa: si no se puede escribir, no se rompe nada */
	}
}

/** Intenta crear el lock de forma atómica. `true` si quedó en nuestras manos. */
function tryAcquire(command) {
	mkdirSync(LOCK_DIR, { recursive: true });
	const payload = JSON.stringify({ pid: process.pid, session: sessionId(), command, startedAt: Date.now(), beatAt: Date.now() });
	try {
		// `wx` falla si el archivo existe: es la parte atómica, no hay ventana entre
		// comprobar y crear.
		const fd = openSync(LOCK_FILE, "wx");
		writeFileSync(fd, payload);
		closeSync(fd);
		return true;
	} catch (e) {
		if (e.code !== "EEXIST") throw e;
		// Existe: sólo se puede tomar si su dueño murió o lo abandonó.
		if (lockHolder()) return false;
		try {
			unlinkSync(LOCK_FILE);
		} catch {
			/* otro lo limpió primero */
		}
		return false; // se reintenta en el próximo ciclo, ya sin carrera
	}
}

function describe(holder) {
	const who = holder.session ? `sesión ${holder.session}` : `pid ${holder.pid}`;
	const age = Math.round((Date.now() - holder.startedAt) / 1000);
	return `${holder.command} (${who}, hace ${age}s)`;
}

/**
 * Ejecuta `fn` con el entorno tomado. Si otra sesión lo tiene, **espera su turno**
 * e informa por stderr para que se vea que está encolado y no colgado.
 *
 * `opts.waitMs` acota la espera; agotada, lanza en vez de atropellar al otro.
 */
export async function withLock(command, fn, opts = {}) {
	const waitMs = opts.waitMs ?? DEFAULT_WAIT_MS;
	const deadline = Date.now() + waitMs;
	let announced = false;

	while (!tryAcquire(command)) {
		const holder = lockHolder();
		if (holder && !announced) {
			console.error(`== esperando turno == el entorno lo está usando: ${describe(holder)}`);
			announced = true;
		}
		if (Date.now() > deadline) {
			const detail = holder ? describe(holder) : "otro proceso";
			throw new Error(`el entorno sigue ocupado por ${detail} tras ${Math.round(waitMs / 1000)}s; reintentá o usá --force`);
		}
		await sleep(POLL_MS);
	}
	if (announced) console.error("== turno tomado ==");

	// Latido: mientras el comando corra, el lock se ve fresco. `unref` para no
	// mantener vivo el proceso sólo por el timer.
	const beat = setInterval(() => {
		try {
			const held = readJson(LOCK_FILE);
			if (held?.pid === process.pid) writeFileSync(LOCK_FILE, JSON.stringify({ ...held, beatAt: Date.now() }));
		} catch {
			/* si desapareció, el finally lo resuelve */
		}
	}, HEARTBEAT_MS);
	beat.unref?.();

	try {
		return await fn();
	} finally {
		clearInterval(beat);
		// La actividad se sella al TERMINAR, nunca antes: sellarla al entrar haría que
		// un `stop` pisara el rastro de la sesión que tiene que respetar. Mientras el
		// comando corre lo que protege es el lock.
		writeActivity(command);
		try {
			// Sólo se borra el propio: si otro lo tomó tras un vencimiento, es suyo.
			if (readJson(LOCK_FILE)?.pid === process.pid) unlinkSync(LOCK_FILE);
		} catch {
			/* ya no está */
		}
	}
}

/**
 * ¿Hay OTRA sesión trabajando ahora mismo? Lo usa `stop` para no llevarse puesto
 * el entorno de un compañero. Sólo puede afirmarlo con `ADC_DRIVER_SESSION`
 * seteada en ambos lados; sin eso devuelve `null` y `stop` sigue como siempre.
 */
export function foreignActivity(withinMs = 10 * 60_000) {
	const me = sessionId();
	const last = lastActivity();
	if (!me || !last?.session || last.session === me) return null;
	// Un `stop` ajeno no es alguien trabajando: esa sesión ya desarmó el entorno y
	// no hay nada suyo que proteger.
	if (last.command === "stop") return null;
	return Date.now() - last.at < withinMs ? last : null;
}
