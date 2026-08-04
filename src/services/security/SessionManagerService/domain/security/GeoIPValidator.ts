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
 * Usa el header cf-ipcountry de Cloudflare; si no está presente, retorna null.
 */
export class GeoIPValidator {
	/**
	 * Extrae el país desde los headers de Cloudflare
	 */
	getCountryFromHeaders(headers: Record<string, string | string[] | undefined>): string | null {
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

	/**
	 * Extrae IP real del request (considerando proxies)
	 */
	extractRealIP(headers: Record<string, string | string[] | undefined>, socketIP: string): string {
		// Orden de prioridad para headers de IP
		const ipHeaders = ["cf-connecting-ip", "x-real-ip", "x-forwarded-for"];

		for (const header of ipHeaders) {
			const value = headers[header.toLowerCase()];
			if (value) {
				const ip = Array.isArray(value) ? value[0] : value.split(",")[0].trim();
				if (this.#isValidIP(ip)) {
					return ip;
				}
			}
		}

		return socketIP || "unknown";
	}

	#isValidIP(ip: string): boolean {
		const ipv4Regex = /^(\d{1,3}\.){3}\d{1,3}$/;
		if (ipv4Regex.test(ip)) {
			const parts = ip.split(".").map(Number);
			return parts.every((p) => p >= 0 && p <= 255);
		}

		// IPv6 (simplificado)
		const ipv6Regex = /^([0-9a-fA-F]{0,4}:){2,7}[0-9a-fA-F]{0,4}$/;
		return ipv6Regex.test(ip);
	}
}
