import proxyaddr from "proxy-addr";
import { Logger } from "../../../../utils/logger/Logger.js";

/**
 * Rangos publicados de Cloudflare (IPv4 + IPv6), expandidos por el alias `cloudflare`.
 *
 * **Rotan**: al actualizarlos, ver https://www.cloudflare.com/ips/. Se hardcodean en vez de
 * bajarlos en el arranque porque un fetch dejaría en manos de un tercero a quién le creemos la IP.
 */
const CLOUDFLARE_IP_RANGES: readonly string[] = [
	// IPv4
	"173.245.48.0/20",
	"103.21.244.0/22",
	"103.22.200.0/22",
	"103.31.4.0/22",
	"141.101.64.0/18",
	"108.162.192.0/18",
	"190.93.240.0/20",
	"188.114.96.0/20",
	"197.234.240.0/22",
	"198.41.128.0/17",
	"162.158.0.0/15",
	"104.16.0.0/13",
	"104.24.0.0/14",
	"172.64.0.0/13",
	"131.0.72.0/22",
	// IPv6
	"2400:cb00::/32",
	"2606:4700::/32",
	"2803:f800::/32",
	"2405:b500::/32",
	"2405:8100::/32",
	"2a06:98c0::/29",
	"2c0f:f248::/32",
];

/** Aliases de conveniencia para `TRUSTED_PROXIES` (los tres últimos ya los entiende `proxy-addr`). */
const ALIASES: Record<string, readonly string[]> = {
	cloudflare: CLOUDFLARE_IP_RANGES,
	loopback: ["loopback"],
	linklocal: ["linklocal"],
	uniquelocal: ["uniquelocal"],
};

/** Confiar en cualquier peer dejaría que el cliente elija su propia IP con un header. */
const FORBIDDEN = new Set(["true", "*", "all"]);

/** Parsea `TRUSTED_PROXIES` (formato y semántica documentados en `.env.example`). */
function parseTrustedProxies(raw = process.env.TRUSTED_PROXIES): string[] {
	const entries = (raw ?? "")
		.split(",")
		.map((entry) => entry.trim().toLowerCase())
		.filter(Boolean);

	const resolved: string[] = [];
	for (const entry of entries) {
		if (FORBIDDEN.has(entry)) {
			Logger.warn(
				`[trusted-proxies] '${entry}' ignorado: confiar en cualquier peer haría que ` +
					`'X-Forwarded-For' fuese elegible por el cliente. Listá los rangos del proxy (o 'cloudflare').`
			);
			continue;
		}
		const alias = ALIASES[entry];
		if (alias) resolved.push(...alias);
		else resolved.push(entry);
	}
	return resolved;
}

/**
 * Valor para la opción `trustProxy` de fastify, o `null` si no hay proxies declarados (y entonces
 * la opción no se setea y `request.ip` sigue siendo la IP del socket).
 *
 * Valida en el arranque y no en el primer request: una lista mal escrita tiene que romper con un
 * motivo, no degradar en silencio a "no confío en nadie" (que detrás del edge banea a cualquiera).
 */
export function resolveTrustProxy(raw = process.env.TRUSTED_PROXIES): string[] | null {
	const list = parseTrustedProxies(raw);
	if (list.length === 0) return null;
	proxyaddr.compile(list); // valida la sintaxis; lanza con el rango culpable
	return list;
}

/** Trust function compilada (memoizada): la misma primitiva que usa fastify para `request.ip`. */
let compiled: ((addr: string, hop: number) => boolean) | null | undefined;

/**
 * `true` si el peer TCP es uno de los proxies confiables.
 *
 * Es la pregunta que no responde `trustProxy`: fastify lo usa para resolver `request.ip` desde
 * `X-Forwarded-For`, pero los headers **propios** del edge (`CF-IPCountry`) no los toca nadie. Sin
 * este gate, cualquiera manda `CF-IPCountry: XX` y dispara —o evita— la revocación por cambio de
 * país.
 */
export function isTrustedProxyPeer(address: string | undefined | null): boolean {
	if (!address) return false;
	if (compiled === undefined) {
		const list = parseTrustedProxies();
		compiled = list.length > 0 ? proxyaddr.compile(list) : null;
	}
	if (!compiled) return false;
	try {
		return compiled(address, 0);
	} catch {
		return false;
	}
}

