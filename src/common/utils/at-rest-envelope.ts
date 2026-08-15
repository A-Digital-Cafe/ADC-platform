import { decryptAtRest, deriveAtRestKey, encryptAtRest, resolveAtRestMasterKey } from "./crypto.ts";

/** Logger mínimo: los consumidores van desde el kernel hasta servicios con `ILogger` completo. */
export interface EnvelopeLogger {
	logWarn(msg: string): void;
}

/** Sellador de un dominio concreto: cifra y abre valores de ESE uso, y de ningún otro. */
export interface AtRestSealer {
	/**
	 * Valor listo para guardar.
	 *
	 * `aad` ata el valor a su lugar (ver {@link AtRestContext}): si se pasa al sellar, hay que pasar
	 * **el mismo** al abrir. La `label` ya separa dominios; el AAD separa filas dentro de un dominio.
	 */
	seal(plaintext: string, logger?: EnvelopeLogger, aad?: string): string;
	/**
	 * Abre lo guardado, o `null` si no descifra (manipulado, corrupto, movido de contexto, escrito
	 * antes de que este uso se cifrara, o la master key cambió entremedio). Loguea el motivo.
	 *
	 * Devuelve `null` en vez de lanzar porque todos los consumidores tratan el fallo como
	 * "no está": vuelven a la fuente de verdad. Lo que **nunca** hacen es aceptar el valor
	 * crudo como fallback — eso sería una vía de degradación permanente y justo el ataque
	 * que el sobre cierra.
	 */
	open(sealed: string | null | undefined, logger?: EnvelopeLogger, aad?: string): string | null;
}

/**
 * Crea un sellador AES-256-GCM para un uso concreto, con su sub-clave derivada de la master
 * key de plataforma (`ADC_STORAGE_MASTER_KEY`).
 *
 * Por qué existe: varios subsistemas guardan secretos en almacenes que **no tienen
 * autenticación** (el Redis compartido, sin `requirepass` y sólo protegido por el bind a
 * loopback). Cada uno necesita lo mismo —derivar su sub-clave una vez por proceso, cifrar al
 * escribir, degradar a "no está" al no poder abrir—, y tenerlo copiado por consumidor
 * garantizaba que alguno se desviara.
 *
 * La `label` separa dominios: comprometer el material de un uso no entrega el de los demás.
 * **Cambiarla invalida lo ya guardado de ese uso**, así que se elige una vez.
 *
 * La sub-clave es determinística a propósito: quien escribe y quien lee suelen ser procesos
 * distintos (varias réplicas), y una clave efímera por proceso dejaría ilegible lo guardado
 * en cada reinicio o recarga en caliente.
 */
export function createAtRestSealer(label: string): AtRestSealer {
	let cachedKey: Buffer | null = null;
	const key = (logger?: EnvelopeLogger): Buffer => {
		cachedKey ??= deriveAtRestKey(resolveAtRestMasterKey(logger), label);
		return cachedKey;
	};

	return {
		seal(plaintext, logger, aad) {
			return encryptAtRest(plaintext, key(logger), { aad });
		},
		open(sealed, logger, aad) {
			if (!sealed) return null;
			try {
				return decryptAtRest(sealed, key(logger), { aad });
			} catch (error) {
				logger?.logWarn(`[at-rest:${label}] valor ilegible (${error}). ¿Cambió ADC_STORAGE_MASTER_KEY o lo escribió otro?`);
				return null;
			}
		},
	};
}
