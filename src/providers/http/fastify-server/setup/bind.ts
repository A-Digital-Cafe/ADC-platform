import type { ILogger } from "../../../../interfaces/utils/ILogger.js";
import { resolveTrustProxy } from "../security/index.js";
import { isRealProduction } from "@common/utils/runtime-env.ts";

/**
 * A qué interfaz se ata el puerto del kernel. `0.0.0.0` por compatibilidad —en desarrollo hay que
 * llegar desde el móvil de la LAN—, pero con un borde delante va la dirección de la overlay o
 * loopback: ver `ADC_BIND_HOST` en `docs/guides/tls-edge.md`.
 */
export function bindHost(): string {
	return process.env.ADC_BIND_HOST?.trim() || "0.0.0.0";
}

/**
 * Avisa cuando el puerto queda abierto al mundo en producción real. Informa en vez de negarse
 * porque no puede ver el firewall, y con firewall puesto la configuración es legítima.
 */
export function warnIfPubliclyBound(host: string, logger: ILogger): void {
	if (!isRealProduction() || (host !== "0.0.0.0" && host !== "::")) return;
	const behindEdge = resolveTrustProxy() !== null;
	logger.logWarn(
		`El puerto del kernel escucha en TODAS las interfaces (ADC_BIND_HOST=${host}). ` +
			(behindEdge
				? "Con un borde delante, alcanzarlo directo saltea TLS, WAF y el rate limit del edge: cerralo por firewall o atalo a la dirección de la red privada."
				: "Además no hay TRUSTED_PROXIES declarados, así que si hay un borde delante toda la gente comparte su IP y el rate limit banea a todos juntos.") +
			" Ver docs/guides/tls-edge.md."
	);
}
