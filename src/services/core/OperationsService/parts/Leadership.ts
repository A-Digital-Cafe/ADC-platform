import type RedisProvider from "../../../../providers/queue/redis/index.ts";
import { nodeId } from "@common/utils/cluster-env.ts";
import type { ILogger } from "../../../../interfaces/utils/ILogger.js";

/**
 * Elección de líder por **lease renovable** en Redis, para que un trabajo periódico corra en UN
 * nodo y no en todos.
 *
 * Por qué hace falta: con dos kernels, cada `setInterval` que escribe se ejecuta dos veces. Algunos
 * son inocuos (un upsert idempotente), otros no: dos barridos de retención compitiendo, dos
 * `git pull` del mismo job programado, o el doble de muestras en las series de recursos, que además
 * falsean los promedios del panel.
 *
 * **Es un lease, no un candado.** Un nodo que se cuelga no bloquea el trabajo para siempre: el
 * lease vence y otro lo toma. La contrapartida —inevitable sin relojes sincronizados— es que en la
 * ventana de vencimiento dos nodos podrían solaparse, así que el trabajo protegido tiene que ser
 * idempotente igual. Esto reduce el trabajo duplicado a casi cero; no lo vuelve imposible.
 *
 * Dos formas, según qué se esté protegiendo:
 *
 * - {@link withLeadership} para un **turno**: se toma, corre y se suelta. El siguiente turno lo
 *   puede tomar cualquiera. Es lo correcto para un barrido idempotente.
 * - {@link claimLeadership} para un **rol** sostenido entre turnos. Hace falta cuando el trabajo
 *   lleva estado en memoria del nodo —una marca de "esto ya lo avisé"— que rotar volvería a cero.
 */
export class Leadership {
	readonly #redis: RedisProvider;
	readonly #logger: ILogger;
	/** Leases vivos de este proceso, para renovarlos y para no re-entrar al mismo trabajo. */
	readonly #held = new Map<string, { timer: ReturnType<typeof setInterval>; value: string }>();
	/** Roles sostenidos por este nodo (ver {@link claimLeadership}). Sin temporizador. */
	readonly #sticky = new Set<string>();

	constructor(redis: RedisProvider, logger: ILogger) {
		this.#redis = redis;
		this.#logger = logger;
	}

	/** Clave del lease. El `keyPrefix` del provider (`adc:ops:`) ya la separa del resto. */
	static #key(name: string): string {
		return `lease:${name}`;
	}

	/**
	 * Corre `fn` **sólo si este nodo consigue el lease** de `name`; si lo tiene otro, devuelve
	 * `undefined` sin ejecutar nada.
	 *
	 * El lease se renueva mientras `fn` corre (a un tercio del TTL), así que un trabajo más largo
	 * que el TTL no se lo pierde a mitad de camino, y se libera al terminar —incluso si `fn`
	 * lanza— para que el próximo turno pueda tomarlo otro nodo.
	 *
	 * @param ttlSeconds cuánto sobrevive el lease sin renovarse. Tiene que ser holgadamente mayor
	 *   que el intervalo entre turnos del trabajo, o dos nodos se lo turnarían.
	 */
	async withLeadership<T>(name: string, ttlSeconds: number, fn: () => Promise<T>): Promise<T | undefined> {
		// Re-entrada: el turno anterior de ESTE nodo sigue corriendo. Saltear es lo correcto —
		// tomar el lease dos veces desde el mismo proceso no lo protege de sí mismo.
		if (this.#held.has(name)) return undefined;

		const key = Leadership.#key(name);
		const value = `${nodeId()}:${Date.now()}`;
		if (!(await this.#redis.setIfAbsent(key, value, ttlSeconds))) return undefined;

		// Renovación: `expire` sobre la clave propia. No se comprueba de quién es porque el único
		// caso en que dejó de ser nuestra es que ya haya vencido, y ahí `expire` reviviría una
		// clave ajena por, como mucho, un TTL. El trabajo protegido es idempotente igual.
		const renewMs = Math.max(1000, Math.floor((ttlSeconds * 1000) / 3));
		const timer = setInterval(() => {
			this.#redis.expire(key, ttlSeconds).catch(() => {
				/* Redis caído: el lease vence solo, que es el comportamiento correcto. */
			});
		}, renewMs);
		// El renovador no debe sostener vivo el proceso al apagarse.
		timer.unref?.();
		this.#held.set(name, { timer, value });

		try {
			return await fn();
		} finally {
			clearInterval(timer);
			this.#held.delete(name);
			await this.#redis.del(key).catch(() => {
				/* Se libera solo al vencer. */
			});
		}
	}

	/**
	 * Liderazgo **sostenido**: no un turno suelto sino un rol ("este nodo es el que corre los
	 * trabajos de fondo"). Se toma con el mismo `SET NX EX` y se **renueva en cada llamada**,
	 * así que sobrevive mientras el nodo siga pidiéndolo y vence solo cuando deja de hacerlo.
	 *
	 * Deliberadamente **sin temporizador de renovación**, al revés que {@link withLeadership}: acá
	 * la renovación *es* la llamada. Un renovador de fondo sostendría el rol en un nodo que dejó de
	 * hacer el trabajo —saturado, con la base caída, a mitad de un apagado— y ningún otro podría
	 * tomarlo; que el silencio lo suelte es justamente la propiedad que se busca.
	 *
	 * @returns `true` si este nodo tiene el rol en este turno.
	 */
	async claimLeadership(name: string, ttlSeconds: number): Promise<boolean> {
		const key = Leadership.#key(name);
		const me = nodeId();
		if (await this.#redis.setIfAbsent(key, me, ttlSeconds)) {
			this.#sticky.add(name);
			return true;
		}
		// Ya tiene dueño: sólo se renueva si somos nosotros. Si es otro nodo, este turno no nos
		// toca y hay que soltar la marca local, o `heldLeases()` mentiría en el panel.
		if ((await this.#redis.get(key)) !== me) {
			this.#sticky.delete(name);
			return false;
		}
		await this.#redis.expire(key, ttlSeconds);
		this.#sticky.add(name);
		return true;
	}

	/** Suelta un rol sostenido —al parar el módulo— si todavía es de este nodo. */
	async releaseLeadership(name: string): Promise<void> {
		this.#sticky.delete(name);
		const key = Leadership.#key(name);
		if ((await this.#redis.get(key)) === nodeId()) await this.#redis.del(key);
	}

	/** Corta las renovaciones pendientes al detener el servicio. */
	stop(): void {
		for (const { timer } of this.#held.values()) clearInterval(timer);
		this.#held.clear();
		this.#sticky.clear();
	}

	/** Nombres de los leases que este nodo sostiene ahora mismo (diagnóstico del panel). */
	heldLeases(): string[] {
		return [...this.#held.keys(), ...this.#sticky];
	}

	/** Aviso único por trabajo cuando se saltea por no ser líder, para no llenar el log. */
	logSkipOnce(name: string, seen: Set<string>): void {
		if (seen.has(name)) return;
		seen.add(name);
		this.#logger.logDebug(`[leadership] "${name}" lo corre otro nodo; este lo saltea.`);
	}
}
