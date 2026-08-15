/**
 * Clientes registrados del proveedor OIDC.
 *
 * **No hay registro dinámico**: un cliente OIDC es algo a lo que la plataforma le cuenta quién sos,
 * así que darlo de alta por API sería dejar que cualquiera se anote para recibir identidades. Se
 * declaran en el `config.json` del servicio.
 *
 * Todos son **públicos con PKCE** (sin secreto), porque el primer consumidor es una consola web y
 * no puede guardar uno. Un cliente confidencial se agrega el día que haya uno de servidor a
 * servidor, y ese día `clientSecret` es un campo más.
 */

/** Un cliente tal como se declara. */
export interface OidcClient {
	clientId: string;
	/** Nombre legible, para la pantalla de error cuando algo no cuadra. */
	name: string;
	/**
	 * URIs de retorno permitidas. La comparación es **exacta**, incluido el path: los comodines son
	 * la forma clásica de convertir un proveedor de identidad en un redirector abierto que entrega
	 * códigos de autorización al primero que pase.
	 */
	redirectUris: string[];
}

/** El bloque `private.oidc` del config.json, ya interpolado (todo llega como string). */
export interface OidcConfig {
	/** Emisor: la URL base con la que este proveedor se identifica. Tiene que ser la pública. */
	issuer: string;
	clients: OidcClient[];
	/** Vigencia del access token e id token, en segundos. */
	tokenTtlSeconds: number;
	/** A dónde se manda al navegador que todavía no inició sesión. */
	loginPath: string;
}

const DEFAULT_TOKEN_TTL = 15 * 60;

function parseClients(raw: unknown): OidcClient[] {
	if (!Array.isArray(raw)) return [];
	const clients: OidcClient[] = [];
	for (const entry of raw as Array<Record<string, unknown>>) {
		const clientId = String(entry?.clientId ?? "").trim();
		const uris = Array.isArray(entry?.redirectUris) ? entry.redirectUris.map((u) => String(u).trim()).filter(Boolean) : [];
		// Un cliente sin URIs no es un cliente a medio configurar: es uno que aceptaría cualquier
		// retorno si algún día el chequeo se relajara. Se descarta al leer.
		if (!clientId || uris.length === 0) continue;
		clients.push({ clientId, name: String(entry.name ?? clientId), redirectUris: uris });
	}
	return clients;
}

export function readOidcConfig(raw: Record<string, unknown> | undefined): OidcConfig {
	const ttl = Number(raw?.tokenTtlSeconds);
	return {
		issuer: String(raw?.issuer ?? "").trim().replace(/\/+$/, ""),
		clients: parseClients(raw?.clients),
		tokenTtlSeconds: Number.isFinite(ttl) && ttl > 0 ? ttl : DEFAULT_TOKEN_TTL,
		loginPath: String(raw?.loginPath ?? "").trim() || "/auth/login",
	};
}

/** `true` si el proveedor tiene con qué funcionar. Sin emisor o sin clientes, no se publica nada. */
export function isOidcEnabled(config: OidcConfig): boolean {
	return config.issuer !== "" && config.clients.length > 0;
}

export function findClient(config: OidcConfig, clientId: string | undefined): OidcClient | null {
	if (!clientId) return null;
	return config.clients.find((c) => c.clientId === clientId) ?? null;
}

/** Comparación exacta contra la lista declarada. Sin prefijos, sin comodines, sin normalizar. */
export function isAllowedRedirect(client: OidcClient, redirectUri: string | undefined): boolean {
	return typeof redirectUri === "string" && client.redirectUris.includes(redirectUri);
}
