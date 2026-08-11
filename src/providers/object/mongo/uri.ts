/**
 * Compone la URI de Mongo desde sus partes.
 *
 * Los `config.json` declaran `host`/`user`/`password`/`options` (que salen del `.env` de la
 * raíz, iguales para todo el árbol) y un `db` propio de cada módulo. Así el clúster se
 * configura UNA vez y cada servicio elige su base sin repetir credenciales — y sin que
 * cambiar la contraseña obligue a tocar quince archivos.
 *
 * Un clúster de Atlas también se compone por partes: `host` con el hostname del clúster y
 * `srv: true` para que salga `mongodb+srv://`, que es como se resuelve un host que publica SRV
 * y TXT pero no registro A.
 *
 * `uri` sigue existiendo para lo que no se compone: la conexión por región de
 * IdentityManagerService.
 */

export interface MongoUriParts {
	/** URI completa. Gana sobre todo lo demás; vacía = componer desde las partes. */
	uri?: string;
	/** `localhost`, `localhost:27017` o una lista de réplicas `h1:27017,h2:27017`. */
	host?: string;
	/** Sólo se usa si `host` no trae puerto. */
	port?: number | string;
	user?: string;
	password?: string;
	/** Base de datos del módulo. Obligatoria al componer: sin ella Mongo caería en `test`. */
	db?: string;
	/** Query de conexión: `"authSource=admin"` o `{ authSource: "admin" }`. */
	options?: string | Record<string, string | number | boolean>;
	/**
	 * `true` para `mongodb+srv://` (el puerto no se usa): es lo que pide un clúster de Atlas, cuyo
	 * host publica SRV y TXT pero **no** registro A, así que un `mongodb://` no resuelve.
	 *
	 * Acepta string porque la interpolación de `config.json` siempre devuelve texto: `"false"` es
	 * un string no vacío y por lo tanto *truthy*, así que la conversión se hace en {@link isSrv} y
	 * nunca por verdad simple. Ver `MONGO_SRV` en los `.env.example`.
	 */
	srv?: boolean | string;
}

/** `srv` en forma de booleano, tolerando el texto que deja la interpolación de `config.json`. */
export function isSrv(parts: Pick<MongoUriParts, "srv"> | undefined): boolean {
	const v = parts?.srv;
	return v === true || v === "true" || v === "1";
}

function normalizeOptions(options: MongoUriParts["options"]): string {
	if (!options) return "";
	if (typeof options === "string") return options.replace(/^\?/, "").trim();
	return Object.entries(options)
		.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
		.join("&");
}

/** `true` si hay partes suficientes para componer (evita adivinar con un objeto vacío). */
export function hasMongoUriParts(parts: MongoUriParts | undefined): boolean {
	return !!parts?.host;
}

export function buildMongoUri(parts: MongoUriParts): string {
	const explicit = parts.uri?.trim();
	if (explicit) return explicit;

	if (!parts.host) throw new Error("MongoProvider: falta `uri` y falta `host` para componerla");
	if (!parts.db) throw new Error(`MongoProvider: falta \`db\` para componer la URI de ${parts.host}`);

	// Usuario y contraseña van percent-encoded: una contraseña con `@`, `:` o `/` rompe el
	// parseo de la URI, y es justo el tipo de contraseña que genera un gestor de secretos.
	const auth = parts.user ? `${encodeURIComponent(parts.user)}:${encodeURIComponent(parts.password ?? "")}@` : "";
	const srv = isSrv(parts);
	// `srv` resuelve los puertos por DNS: agregarlos ahí es un error de sintaxis.
	const host = srv || parts.host.includes(":") || !parts.port ? parts.host : `${parts.host}:${parts.port}`;
	const query = normalizeOptions(parts.options);

	return `${srv ? "mongodb+srv" : "mongodb"}://${auth}${host}/${encodeURIComponent(parts.db)}${query ? `?${query}` : ""}`;
}

/** URI sin la contraseña, para logs, `getStats()` y respuestas del panel. */
export function redactMongoUri(uri: string): string {
	return uri.replace(/\/\/([^:@/]+):[^@/]*@/, "//$1:***@");
}

/** `esquema://[auth@]hosts[/db][?query]`. Los hosts pueden venir separados por coma. */
const MONGO_URI_RE = /^(mongodb(?:\+srv)?):\/\/(?:([^@]*)@)?([^/?]+)(?:\/([^?]*))?(?:\?(.*))?$/i;

/**
 * Separa la URI en la clave del pool FÍSICO (sin base) y el nombre de la base.
 *
 * Es lo que permite que N módulos con la misma conexión y distinta base compartan un solo
 * socket. Se parsea a mano y no con `new URL`: una URI de replica set (`h1:27017,h2:27017`)
 * no es una URL válida, y el fallback anterior devolvía la base `test` — es decir, todos los
 * módulos escribiendo en la misma base equivocada.
 */
export function splitMongoUri(uri: string): { physicalKey: string; dbName: string } {
	const m = MONGO_URI_RE.exec(uri.trim());
	if (!m) return { physicalKey: uri, dbName: "test" };
	const [, scheme, auth, hosts, rawDb, query] = m;
	// Query ordenada: dos módulos que declaran las mismas opciones en distinto orden tienen
	// que resolver al MISMO pool.
	const sorted = query
		? [...new URLSearchParams(query).entries()].sort(([a], [b]) => a.localeCompare(b))
		: [];
	const search = sorted.length > 0 ? `?${new URLSearchParams(sorted).toString()}` : "";
	let dbName = "test";
	if (rawDb) {
		try {
			dbName = decodeURIComponent(rawDb) || "test";
		} catch {
			dbName = rawDb;
		}
	}
	return { physicalKey: `${scheme.toLowerCase()}://${auth ? `${auth}@` : ""}${hosts}/${search}`, dbName };
}
