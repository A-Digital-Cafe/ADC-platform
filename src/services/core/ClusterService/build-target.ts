import type RedisProvider from "../../../providers/queue/redis/index.ts";

/**
 * Clave del `build-id` **vigente** de la flota. Vive en Redis junto al registro de nodos porque es
 * el mismo tipo de dato: algo que un nodo publica, el resto lee y nadie tiene que reconciliar.
 */
const KEY = "build:current";

/**
 * Vence sola, y por eso el valor es alto: mientras el primario esté vivo la refresca en cada
 * latido, así que un TTL corto sólo serviría para levantar el drenaje mientras el primario
 * reinicia —justo cuando los nodos viejos NO deben volver a rotación—. Diez minutos es "el
 * primario ya no está" y no "el primario está reiniciando": ahí sí conviene que la flota vuelva a
 * servir con lo que tenga antes que quedarse sin nadie.
 */
const TARGET_TTL_SECONDS = 600;

/**
 * Qué build **debería** estar sirviendo la flota, y si este nodo lo tiene.
 *
 * Lo publica el primario (el nodo desde el que se despliega) y lo leen los demás. Es lo que
 * convierte "este nodo quedó atrás" en una respuesta que un balanceador entiende: un nodo con
 * artefactos viejos sirviendo el mismo vhost que uno nuevo produce 404 intermitentes de chunks,
 * que es de los errores más caros de diagnosticar; sacarlo de rotación es preferible a servirlos.
 *
 * **Con un solo nodo no hace nada**: el primario publica su propio id y se compara consigo mismo.
 */
export class BuildTarget {
	readonly #redis: RedisProvider;
	#expected: string | null = null;

	constructor(redis: RedisProvider) {
		this.#redis = redis;
	}

	/**
	 * Publica (si es el primario) o relee el build vigente. Se llama en cada latido para que el id
	 * siga a los deploys sin reiniciar el proceso.
	 *
	 * Un fallo de Redis **conserva el último valor conocido** en vez de limpiarlo: olvidarlo
	 * significaría que un parpadeo del Redis devuelve a rotación a todos los nodos desactualizados
	 * de golpe, que es exactamente el estado que esto existe para evitar.
	 */
	async sync(ownBuildId: string, isPrimary: boolean): Promise<void> {
		try {
			if (isPrimary) {
				await this.#redis.setex(KEY, TARGET_TTL_SECONDS, ownBuildId);
				this.#expected = ownBuildId;
				return;
			}
			this.#expected = await this.#redis.get(KEY);
		} catch {
			/* se conserva lo último leído: ver el porqué arriba */
		}
	}

	/** Build que la flota debería servir, o `null` si nadie lo publicó (ahí no se drena a nadie). */
	expected(): string | null {
		return this.#expected;
	}
}
