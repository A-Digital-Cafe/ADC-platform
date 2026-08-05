/** Cloudflare country header */
const CF_IPCOUNTRY_HEADER = "cf-ipcountry";

/** Resultado de validación geográfica */
interface GeoValidationResult {
	valid: boolean;
	currentCountry: string | null;
	previousCountry: string | null;
	reason?: string;
}

/**
 * GeoIPValidator - Validación geográfica usando headers de Cloudflare
 *
 * Detecta cambios de país para revocar tokens y solicitar re-login.
 * Usa el header `cf-ipcountry` de Cloudflare; si no está presente, retorna null.
 *
 * **La IP del cliente no se resuelve acá**: la resuelve el provider HTTP contra la allowlist de
 * `TRUSTED_PROXIES` y llega por `ctx.ip`, que es también la clave del rate limit. Una sola noción
 * de "IP del cliente" en toda la plataforma, y ninguna que el cliente pueda elegir con un header.
 */
export class GeoIPValidator {
	/**
	 * País del cliente según Cloudflare, o `null` si no se puede afirmar.
	 *
	 * `viaTrustedProxy` es obligatorio y sin default: `CF-IPCountry` no lo valida nadie, así que
	 * mandarlo a mano evitaría la revocación por cambio de país —o la dispararía contra la sesión
	 * de otro—. En dev (sin `TRUSTED_PROXIES`) siempre es `null`, y `validateLocationChange`
	 * acepta cuando no puede determinar el país.
	 */
	getCountryFromHeaders(headers: Record<string, string | string[] | undefined>, viaTrustedProxy: boolean): string | null {
		if (!viaTrustedProxy) return null;

		const cfCountry = headers[CF_IPCOUNTRY_HEADER];
		if (!cfCountry) return null;

		const country = Array.isArray(cfCountry) ? cfCountry[0] : cfCountry;
		// XX = unknown, T1 = Tor
		if (country === "XX" || country === "T1") return null;

		return country;
	}

	/**
	 * Valida si el cambio de país es aceptable
	 */
	validateLocationChange(currentCountry: string | null, previousCountry: string | null): GeoValidationResult {
		// Si no tenemos país anterior, aceptar
		if (!previousCountry) {
			return { valid: true, currentCountry, previousCountry: null };
		}

		// Si no podemos determinar el país actual, ser conservador y aceptar
		if (!currentCountry) {
			return { valid: true, currentCountry: null, previousCountry };
		}

		// Comparar países
		if (currentCountry !== previousCountry) {
			return {
				valid: false,
				currentCountry,
				previousCountry,
				reason: `Cambio de país detectado: ${previousCountry} → ${currentCountry}`,
			};
		}

		return { valid: true, currentCountry, previousCountry };
	}
}
