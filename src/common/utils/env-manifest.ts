/**
 * Manifiesto de las variables de entorno de la **raíz**: a qué archivo de `env/` va cada una, cuáles
 * son propias del nodo y cuáles tienen que ser idénticas en todos. Fuente única para el cargador, el
 * migrador, el configurador y el runbook, que antes mantenían la misma lista cada uno por su lado.
 *
 * **No cubre las variables de módulo**: ésas viven en el `.env` junto al `config.json` del módulo y
 * las lee `ModuleLoader` aparte, con prioridad sobre `process.env`.
 *
 * Al agregar una variable: sumarla acá **y** al `.example` de su grupo, o la auditoría del
 * configurador la reporta como faltante.
 */

/** Un archivo de `env/`. El nombre del grupo es el nombre del archivo (`host` → `env/host.env`). */
export type EnvGroup = "identity" | "build" | "storage" | "mail" | "optionals" | "network" | "secrets" | "host";

/**
 * Orden de carga: **el último gana**. `host` va último porque es el archivo del nodo concreto y
 * tiene que poder pisar cualquier default heredado; `secrets` anteúltimo por lo mismo.
 */
export const ENV_GROUP_ORDER: readonly EnvGroup[] = ["identity", "build", "storage", "mail", "optionals", "network", "secrets", "host"];

export interface EnvVarDef {
	name: string;
	group: EnvGroup;
	/**
	 * Tiene que ser **idéntica** en todos los nodos del clúster. El caso simétrico («propia de este
	 * nodo») es el grupo `host`, derivado en {@link NODE_SCOPED_VARS}.
	 */
	shared?: boolean;
	/** Qué se rompe si difiere entre nodos: todas fallan tarde y en confuso, y el síntoma es lo único que orienta. */
	why?: string;
	/**
	 * Se lee por un camino que el escáner del configurador **no ve** como `process.env.X`; sin la
	 * marca las reportaría como huérfanas y ofrecería borrarlas.
	 *
	 * - `public-env`: se resuelve por el mapa `PUBLIC_ENV_VARS` de `public-env-vars.ts`.
	 * - `cluster-env`: se lee por el helper `env("…")` de `cluster-env.ts`.
	 * - `compose-only`: no la lee el proceso, sólo la interpola un `docker-compose.yml`.
	 */
	indirect?: "public-env" | "cluster-env" | "compose-only";
	/**
	 * Su valor vive en `platform_settings` (ver `PlatformSettingsService`) y **ya no va en ningún
	 * `env/*.env`**; queda declarada para que la auditoría no la reporte como desconocida. Si además
	 * está en el entorno, la base le gana y el arranque lo avisa por log.
	 */
	source?: "platform-settings";
}

const IDENTITY_VARS: readonly string[] = [
	"ADC_PUBLIC_DATA_FISCAL_QR",
	"ADC_PUBLIC_OPERATOR_LEGAL_NAME",
	"ADC_PUBLIC_OPERATOR_TAX_ID",
	"ADC_PUBLIC_OPERATOR_COUNTRY",
	"ADC_PUBLIC_OPERATOR_ADDRESS",
	"ADC_PUBLIC_OPERATOR_TAX_STATUS",
	"ADC_PUBLIC_OPERATOR_PHONE",
	"ADC_PUBLIC_CONTACT_EMAIL",
	"ADC_PUBLIC_DISCORD_HANDLE",
	"ADC_PUBLIC_DISCORD_URL",
	"ADC_PUBLIC_DISCORD_VIP_URL",
	"ADC_PUBLIC_SOCIAL_TWITCH",
	"ADC_PUBLIC_SOCIAL_YOUTUBE",
	"ADC_PUBLIC_SOCIAL_INSTAGRAM",
	"ADC_PUBLIC_SOCIAL_GITHUB",
	"ADC_PUBLIC_DONATIONS_URL",
	"ADC_PUBLIC_CREATOR_URL",
	"ADC_PUBLIC_SOURCE_REPO_URL",
];

export const ENV_VARS: readonly EnvVarDef[] = [
	// ── host: la identidad y la forma de ESTE nodo. Nunca se copia a otro. ──────────────────────
	{ name: "ADC_NODE_ID", group: "host", indirect: "cluster-env" },
	{ name: "ADC_NODE_NAME", group: "host", indirect: "cluster-env" },
	{ name: "ADC_NODE_ROLE", group: "host", indirect: "cluster-env" },
	{ name: "ADC_NODE_SITE", group: "host", indirect: "cluster-env" },
	{ name: "ADC_SITE_NAME", group: "host", indirect: "cluster-env" },
	{ name: "ADC_NODE_ADVERTISE", group: "host", indirect: "cluster-env" },
	{ name: "ADC_CLUSTER_GATEWAY", group: "host", indirect: "cluster-env" },
	{ name: "ADC_INFRA_COMPOSE", group: "host" },
	{ name: "ADC_BUILD_ID", group: "host" },
	{ name: "MONGO_RS_MEMBER_HOST", group: "host" },
	// El plano de control del sharding es del nodo primario y su miembro se anuncia por nombre de
	// contenedor: es tan del host como el miembro del replica set de al lado.
	{ name: "MONGO_CONFIG_MEMBER_HOST", group: "host" },
	{ name: "ADC_DOCKER_DATA_PATH", group: "host" },
	{ name: "GARAGE_CAPACITY", group: "host" },
	{ name: "GARAGE_RPC_BIND_HOST", group: "host" },
	// La dirección con la que el almacenamiento de este nodo se anuncia a los otros. Es del host por
	// definición y NO se hereda: un secundario que copie la del primario se anuncia como el primario.
	{ name: "GARAGE_RPC_PUBLIC_ADDR", group: "host", indirect: "compose-only" },
	{ name: "S3_BIND_HOST", group: "host" },
	// Loopback por defecto; con más de un nodo, la dirección de overlay de ESTA máquina. Un miembro
	// del replica set que se anuncia por una dirección que su contenedor no publica se queda en
	// `STARTUP` para siempre.
	{ name: "MONGO_BIND_HOST", group: "host", indirect: "compose-only" },
	{ name: "REDIS_BIND_HOST", group: "host", indirect: "compose-only" },
	{ name: "MAIL_BIND_HOST", group: "host", indirect: "compose-only" },
	// `<host> <puerto>` del master, sólo en los nodos réplica. Vacío = este Redis es el master.
	{ name: "REDIS_REPLICA_OF", group: "host", indirect: "compose-only" },
	{ name: "ADC_HOST", group: "host" },
	{ name: "PROD_PORT", group: "host" },
	{ name: "ADC_BIND_HOST", group: "host" },
	{ name: "SSL_CERT_PATH", group: "host" },
	{ name: "SSL_KEY_PATH", group: "host" },
	// Alta de este nodo: se ponen a mano una vez en una máquina virgen y el token queda inservible al
	// canjearse.
	{ name: "ADC_NODE_JOIN_URL", group: "host" },
	{ name: "ADC_NODE_JOIN_TOKEN", group: "host" },
	{ name: "NETBIRD_BIND_HOST", group: "host", indirect: "compose-only" },
	{ name: "NETBIRD_ADMIN_PORT", group: "host", indirect: "compose-only" },
	{ name: "NETBIRD_PUBLIC_PORT", group: "host", indirect: "compose-only" },
	{ name: "NETBIRD_RELAY_PORT", group: "host", indirect: "compose-only" },
	{ name: "NETBIRD_SIGNAL_PORT", group: "host", indirect: "compose-only" },
	// Con qué dirección pública se anuncia el STUN/TURN: depende de detrás de qué NAT está el host.
	{ name: "NETBIRD_TURN_EXTERNAL_IP", group: "host", indirect: "compose-only" },
	{ name: "NETBIRD_TURN_MIN_PORT", group: "host", indirect: "compose-only" },
	{ name: "NETBIRD_TURN_MAX_PORT", group: "host", indirect: "compose-only" },

	// ── network: cómo se expone y en quién confía. Igual en todos los nodos. ────────────────────
	{ name: "TRUSTED_PROXIES", group: "network" },
	{ name: "CORS_ALLOWED_ORIGINS", group: "network" },
	{ name: "HTTP_BODY_LIMIT_BYTES", group: "network", source: "platform-settings" },
	{ name: "HTTP_RAW_BODY_LIMIT_BYTES", group: "network", source: "platform-settings" },
	{ name: "SECURITY_CSP_ENFORCE", group: "network" },
	{ name: "SECURITY_ENABLE_HSTS", group: "network" },
	{ name: "SECURITY_CSP_SCRIPT_NONCE", group: "network" },
	{ name: "ADC_CF_BEACON_TOKEN", group: "network" },
	{ name: "HTTP2_ENABLED", group: "network" },
	// La plataforma como PROVEEDOR de identidad OpenID Connect. El emisor tiene que ser la URL
	// pública: viaja adentro de cada token y es contra lo que el consumidor valida.
	{ name: "ADC_OIDC_ISSUER", group: "network" },
	{ name: "ADC_OIDC_TOKEN_TTL_SECONDS", group: "network" },
	{ name: "SESSION_COOKIE_DOMAIN", group: "network" },
	{ name: "SESSION_OAUTH_BASE_URL", group: "network" },
	{ name: "SESSION_CHANGE_PASSWORD_URL", group: "network" },
	// Red privada (overlay). No hay `NETBIRD_VERSION`: la imagen del plano de control se pinea por
	// digest en el compose, y una variable con el tag sería una perilla remota —viaja a cada nodo en
	// el alta por token— sobre qué binario corre la red privada.
	{ name: "ADC_NETBIRD_DOMAIN", group: "network", indirect: "compose-only" },
	// La lee el panel y **tiene que ser loopback**: el cliente se niega a hablarle a otra cosa.
	{ name: "ADC_NETBIRD_MANAGEMENT_URL", group: "network" },
	{ name: "NETBIRD_TURN_DOMAIN", group: "network", indirect: "compose-only" },
	{ name: "NETBIRD_TURN_USER", group: "network", indirect: "compose-only" },
	{ name: "NETBIRD_MGMT_DNS_DOMAIN", group: "network", indirect: "compose-only" },
	{ name: "NETBIRD_MGMT_DISABLE_DEFAULT_POLICY", group: "network", indirect: "compose-only" },
	// NetBird self-hosted **no tiene usuarios propios**: delega en un OIDC externo, así que sin estas
	// variables el plano de control levanta y nadie puede autenticarse contra su API. Sin default a
	// propósito.
	{ name: "NETBIRD_AUTH_OIDC_CONFIGURATION_ENDPOINT", group: "network", indirect: "compose-only" },
	{ name: "NETBIRD_AUTH_AUTHORITY", group: "network", indirect: "compose-only" },
	{ name: "NETBIRD_AUTH_CLIENT_ID", group: "network", indirect: "compose-only" },
	{ name: "NETBIRD_AUTH_AUDIENCE", group: "network", indirect: "compose-only" },
	{ name: "NETBIRD_AUTH_SUPPORTED_SCOPES", group: "network", indirect: "compose-only" },
	{ name: "NETBIRD_AUTH_TOKEN_ENDPOINT", group: "network", indirect: "compose-only" },
	{ name: "NETBIRD_AUTH_PKCE_AUTHORIZATION_ENDPOINT", group: "network", indirect: "compose-only" },
	{ name: "NETBIRD_AUTH_REDIRECT_URI", group: "network", indirect: "compose-only" },
	{ name: "NETBIRD_AUTH_SILENT_REDIRECT_URI", group: "network", indirect: "compose-only" },
	{ name: "NETBIRD_AUTH_USER_ID_CLAIM", group: "network", indirect: "compose-only" },
	{ name: "NETBIRD_TOKEN_SOURCE", group: "network", indirect: "compose-only" },
	{ name: "NETBIRD_MGMT_IDP", group: "network", indirect: "compose-only" },
	{ name: "NETBIRD_IDP_MGMT_CLIENT_ID", group: "network", indirect: "compose-only" },
	// Desde qué rangos se acepta canjear un token de alta. **Vacío = alta deshabilitada**: es un
	// gate cuyo fallo abierto entregaría los secretos compartidos a cualquiera con el token.
	{ name: "ADC_NODE_JOIN_CIDRS", group: "network" },
	// Alta y baja de subdominios del túnel desde el panel de red, en vez de por `cloudflared` en el
	// nodo primario. Sin `CLOUDFLARE_API_TOKEN` la tab se ve pero no opera; el token es el único
	// secreto del grupo y por eso vive con los demás.
	{ name: "CLOUDFLARE_ACCOUNT_ID", group: "network" },
	{ name: "CLOUDFLARE_ZONE_ID", group: "network" },
	{ name: "CLOUDFLARE_ZONE_NAME", group: "network" },
	{ name: "CLOUDFLARE_TUNNEL_ID", group: "network" },
	{ name: "CLOUDFLARE_TUNNEL_NAME", group: "network" },
	// Reparto de carga entre nodos sin balanceador. Se autodesactiva cuando hay uno adelante —la
	// presión de cada nodo no llega al umbral—, así que no hace falta apagarlo al migrar a Cloudflare.
	{ name: "ADC_OFFLOAD_ENABLED", group: "network" },
	{ name: "ADC_OFFLOAD_HIGH_WATER", group: "network" },
	{ name: "ADC_OFFLOAD_MARGIN", group: "network" },
	{ name: "ADC_OFFLOAD_MIN_ROUTE_MS", group: "network" },
	{ name: "ADC_OFFLOAD_CROSS_SITE", group: "network" },

	// ── storage: dónde viven los datos, agrupado por motor ──────────────────────────────────────
	{ name: "MONGO_HOST", group: "storage" },
	{ name: "MONGO_OPTIONS", group: "storage" },
	{ name: "MONGO_REPLICA_SET", group: "storage" },
	{ name: "MONGO_CONFIG_REPLICA_SET", group: "storage" },
	{ name: "MONGO_MONGOS_PORT", group: "storage" },
	// `--shardsvr` o vacío. En `storage` y no en `host` porque la tienen que tener TODOS los nodos
	// que alojen un miembro del replica set: es propiedad del clúster, no de una máquina.
	{ name: "MONGO_SHARDSVR", group: "storage" },
	{ name: "MONGODB_URI", group: "storage" },
	{ name: "DASHBOARD_MONGO_HOST", group: "storage" },
	{ name: "DASHBOARD_MONGO_OPTIONS", group: "storage" },
	{ name: "REDIS_HOST", group: "storage" },
	{ name: "REDIS_PORT", group: "storage" },
	{ name: "RABBITMQ_MANAGEMENT_URL", group: "storage" },
	{ name: "RABBITMQ_QUEUE_TYPE", group: "storage" },
	{ name: "S3_ENDPOINT", group: "storage" },
	{ name: "S3_PUBLIC_ENDPOINT", group: "storage" },
	{ name: "S3_REGION", group: "storage" },
	{ name: "S3_BUCKET", group: "storage" },
	{ name: "PM_S3_BUCKET", group: "storage" },
	{ name: "GARAGE_ADMIN_URL", group: "storage" },
	{ name: "GARAGE_REPLICATION_FACTOR", group: "storage", shared: true, why: "ese nodo se niega a arrancar: su factor no coincide con el del layout guardado", indirect: "compose-only" },
	{ name: "GARAGE_BUCKETS", group: "storage", indirect: "compose-only" },
	// Techo de venta. La CAPACIDAD es por nodo (cada máquina tiene su disco); la POLÍTICA de cuánto
	// se compromete es del clúster y vive en la base, editable desde el panel de nodos.
	{ name: "ADC_STORAGE_CAPACITY_BYTES", group: "storage" },
	{ name: "ADC_STORAGE_CAPACITY_PATH", group: "storage" },
	{ name: "ADC_STORAGE_HEADROOM_PCT", group: "storage", source: "platform-settings" },
	{ name: "ADC_STORAGE_OVERSUBSCRIPTION", group: "storage", source: "platform-settings" },
	{ name: "ADC_STORAGE_MIN_FREE_PCT", group: "storage", source: "platform-settings" },

	// ── mail ────────────────────────────────────────────────────────────────────────────────────
	{ name: "MAIL_HOSTNAME", group: "mail" },
	{ name: "MAIL_ROOT_DOMAIN", group: "mail" },
	{ name: "MAIL_INTERNAL_ONLY", group: "mail" },
	{ name: "MAIL_DEV_LOOPBACK", group: "mail" },
	{ name: "MAIL_DKIM_SELECTOR", group: "mail" },
	{ name: "MAIL_MTA_STS_MODE", group: "mail" },
	{ name: "MAIL_MTA_STS_MAX_AGE", group: "mail" },
	{ name: "MAIL_RELAY_TLS_INSECURE", group: "mail" },
	{ name: "MAIL_RELAY_PORT", group: "mail" },
	{ name: "MAIL_TRASH_RETENTION_DAYS", group: "mail" },
	{ name: "MAIL_SPAM_RETENTION_DAYS", group: "mail" },
	{ name: "MAIL_SEND_LOG_RETENTION_DAYS", group: "mail" },
	{ name: "MAIL_INBOUND_WEBHOOK_URL", group: "mail", indirect: "compose-only" },
	{ name: "MAIL_REDIS_HOST", group: "mail", indirect: "compose-only" },
	{ name: "MAIL_REDIS_PORT", group: "mail", indirect: "compose-only" },
	{ name: "MAIL_REDIS_USER", group: "mail", indirect: "compose-only" },

	// ── build: qué compila y cuánto habla este proceso. Es de la máquina, no del clúster. ───────
	{ name: "LOG_LEVEL", group: "build" },
	{ name: "ADC_NO_UI_SERVERS", group: "build" },
	{ name: "ADC_UI_APPS", group: "build" },
	{ name: "ADC_LOAD_APPS", group: "build" },
	{ name: "ADC_UI_SOURCEMAPS", group: "build" },
	{ name: "ADC_SERVE_SOURCEMAPS", group: "build" },
	{ name: "ADC_DEFER_UI_BUILDS", group: "build" },
	{ name: "ENABLE_TESTS", group: "build" },
	{ name: "BOOT_MAX_PARALLEL", group: "build" },
	{ name: "ADC_BOOT_TIMELINE", group: "build" },
	{ name: "ADC_RSPACK_CACHE", group: "build" },
	{ name: "ADC_LOCAL_PROD", group: "build" },
	{ name: "DEBUG_NON_FATAL", group: "build" },
	{ name: "ASSET_PATH", group: "build" },

	// ── optionals: integraciones y frenos que casi nunca se tocan ───────────────────────────────
	{ name: "ADC_GITHUB_CLIENT_ID", group: "optionals", source: "platform-settings" },
	{ name: "ADC_GITHUB_TOKEN_TTL_MINUTES", group: "optionals", source: "platform-settings" },
	{ name: "IDLE_TICK_SECONDS", group: "optionals", source: "platform-settings" },
	{ name: "IDLE_MAX_CPU_PERCENT", group: "optionals", source: "platform-settings" },
	{ name: "IDLE_MAX_LOAD_PER_CORE", group: "optionals", source: "platform-settings" },
	{ name: "IDLE_BATCH_BUDGET_MS", group: "optionals", source: "platform-settings" },
	{ name: "IDLE_MAX_BACKOFF_MINUTES", group: "optionals", source: "platform-settings" },
	{ name: "IDLE_MAX_CONSECUTIVE_FAILURES", group: "optionals", source: "platform-settings" },
	{ name: "ADC_DRAIN_MS", group: "optionals" },
	{ name: "ADC_SHUTDOWN_INFRA_TIMEOUT_MS", group: "optionals" },
	{ name: "ADC_SHUTDOWN_BUDGET_MS", group: "optionals" },
	// De qué base importa el panel de red las etiquetas de nodo la primera vez. Sólo aplica a un
	// despliegue anterior a que ese DAO se mudara de preset.
	{ name: "NETWORK_LEGACY_LABELS_DB", group: "optionals" },
	// Frenos del barrido de integridad. Los defaults sirven para un despliegue chico; con bases
	// grandes lo primero que se toca es apagar el `validate` por colección.
	{ name: "ADC_INTEGRITY_REVISIT_HOURS", group: "optionals", source: "platform-settings" },
	{ name: "ADC_INTEGRITY_VALIDATE", group: "optionals", source: "platform-settings" },
	{ name: "ADC_INTEGRITY_MAX_COLLECTIONS", group: "optionals", source: "platform-settings" },
	{ name: "ADC_INTEGRITY_MIN_OPLOG_HOURS", group: "optionals", source: "platform-settings" },
	{ name: "ADC_INTEGRITY_MIN_FREE_RATIO", group: "optionals", source: "platform-settings" },
	{ name: "LEGAL_ACCEPTANCE_RETENTION_DAYS", group: "optionals", source: "platform-settings" },
	{ name: "ACCOUNT_DELETION_CANCEL_URL", group: "optionals", source: "platform-settings" },
	{ name: "EMAIL_CHANGE_CONFIRM_URL", group: "optionals", source: "platform-settings" },

	// ── secrets: los que tienen que ser IDÉNTICOS en todos los nodos; el `why` es el síntoma ────
	{
		name: "ADC_STORAGE_MASTER_KEY",
		group: "secrets",
		shared: true,
		why: "los adjuntos cifrados quedan ilegibles y los trabajos en vuelo pierden su sesión",
	},
	{ name: "BAN_HASH_PEPPER", group: "secrets", shared: true, why: "los bans dejan de matchear y un usuario baneado entra por el otro nodo" },
	{ name: "ACCOUNT_DELETION_SECRET", group: "secrets", shared: true, why: "invalida los enlaces de arrepentimiento ya enviados" },
	{
		name: "MAIL_INBOUND_WEBHOOK_SECRET",
		group: "secrets",
		shared: true,
		why: "el correo entrante que reciba ese nodo se descarta como no autenticado",
	},
	{
		name: "MAIL_REDIS_PASSWORD",
		group: "secrets",
		shared: true,
		indirect: "compose-only",
		why: "el MTA no autentica contra Redis y pierde los topes de rate, que es lo que frena la enumeración de casillas",
	},
	{ name: "GARAGE_RPC_SECRET", group: "secrets", shared: true, why: "el Garage nuevo no logra hablar con el existente y nunca aparece en `garage status`" },
	// Secretos del plano de control de la red privada. Viven SÓLO en el primario —es el único que
	// levanta ese stack—, así que no son `shared`: copiarlos a un secundario reparte las credenciales
	// de la red sin ninguna ganancia.
	{
		name: "NETBIRD_DATASTORE_ENC_KEY",
		group: "secrets",
		indirect: "compose-only",
		why: "cifra el almacén del plano de control (claves de alta, tokens): sin ella, quien lea el volumen se lleva las credenciales de la red entera",
	},
	{
		name: "NETBIRD_RELAY_AUTH_SECRET",
		group: "secrets",
		indirect: "compose-only",
		why: "si el relay y el plano de control no comparten el mismo valor, los peers conectan y el relay los rechaza: se ve como «la red anda pero algunos no se alcanzan»",
	},
	{
		name: "NETBIRD_TURN_PASSWORD",
		group: "secrets",
		indirect: "compose-only",
		why: "si el TURN y el plano de control no comparten la misma, el descubrimiento de NAT falla y todo el tráfico cae al relay: la red anda y es lenta",
	},
	{ name: "NETBIRD_IDP_MGMT_CLIENT_SECRET", group: "secrets", indirect: "compose-only", why: "el plano de control no puede consultar el proveedor de identidad" },
	// Va **vacía** contra el OIDC de esta plataforma: `SessionManagerService` emite clientes públicos
	// con PKCE y no admite autenticación de cliente. Se declara igual —y en `secrets`, no en
	// `optionals`— porque el día que la consola de la red se apoye en otro proveedor, su valor es un
	// secreto y ya tiene destino: sin entrada en el manifiesto habría caído en el archivo equivocado.
	{
		name: "NETBIRD_AUTH_CLIENT_SECRET",
		group: "secrets",
		indirect: "compose-only",
		why: "sólo con un proveedor de identidad que exija secreto: sin ella la consola de la red no completa el login",
	},
	{ name: "GARAGE_ADMIN_TOKEN", group: "secrets", shared: true, why: "el panel no puede leer el layout del almacenamiento de objetos de ese nodo" },
	{
		name: "CLOUDFLARE_API_TOKEN",
		group: "secrets",
		shared: true,
		why: "la tab de Routing queda en sólo lectura: publicar un subdominio vuelve a exigir sesión en el nodo primario y no se puede purgar el caché del borde (permisos del token: Zone:DNS:Edit + Zone:Cache Purge)",
	},
	{ name: "MONGO_USER", group: "secrets", shared: true, why: "el nodo arranca y se queda sin base, que es el fallo más ruidoso de la lista" },
	{ name: "MONGO_PASSWORD", group: "secrets", shared: true, why: "el nodo arranca y se queda sin base, que es el fallo más ruidoso de la lista" },
	{ name: "REDIS_PASSWORD", group: "secrets", shared: true, why: "sesiones, rate limit y leases dejan de funcionar en ese nodo" },
	{ name: "RABBITMQ_USER", group: "secrets", shared: true, why: "se pierde el bus entre nodos, que es best-effort y por eso falla en silencio" },
	{ name: "RABBITMQ_PASSWORD", group: "secrets", shared: true, why: "se pierde el bus entre nodos, que es best-effort y por eso falla en silencio" },
	// Lleva usuario y contraseña embebidos en la URL: es un secreto aunque se llame «URL».
	{ name: "RABBITMQ_URL", group: "secrets", shared: true, why: "se pierde el bus entre nodos, que es best-effort y por eso falla en silencio" },
	{ name: "S3_ACCESS_KEY", group: "secrets", shared: true, why: "las subidas responden 403 opacos" },
	{ name: "S3_SECRET_KEY", group: "secrets", shared: true, why: "las subidas responden 403 opacos" },

	// ── identity: la identidad pública del operador, horneada en los bundles del navegador. ─────
	...IDENTITY_VARS.map((name): EnvVarDef => ({ name, group: "identity", indirect: "public-env" })),
];

/** Búsqueda por nombre. Cada variable tiene UN nombre: el código no acepta alternativas. */
const BY_NAME = new Map<string, EnvVarDef>(ENV_VARS.map((def) => [def.name, def]));

/** A qué archivo de `env/` va una variable, o `null` si el manifiesto no la conoce. */
export function groupOf(name: string): EnvGroup | null {
	return BY_NAME.get(name)?.group ?? null;
}

/** Definición de una variable por su nombre o alias. */
export function envVarDef(name: string): EnvVarDef | null {
	return BY_NAME.get(name) ?? null;
}

/** Las que **no** se heredan al dar de alta un nodo: exactamente el contenido de `env/host.env`. */
export const NODE_SCOPED_VARS: ReadonlySet<string> = new Set(ENV_VARS.filter((v) => v.group === "host").map((v) => v.name));

/**
 * Las que tienen que ser idénticas en todos los nodos, con el síntoma de que no lo sean.
 * **Nunca se emite el VALOR de ninguna**: acá viven los nombres y el porqué, nada más.
 */
export const SHARED_SECRET_VARS: readonly EnvVarDef[] = ENV_VARS.filter((v) => v.shared);

/** Las que el escáner del configurador no puede descubrir leyendo `process.env.X`. */
export const INDIRECT_VARS: ReadonlySet<string> = new Set(ENV_VARS.filter((v) => v.indirect).map((v) => v.name));

/**
 * Las que ya **no** van en ningún `env/*.env`: su valor vive en `platform_settings`.
 *
 * Acá sólo figuran las que **estuvieron** en `env/`, para que la auditoría sepa que su ausencia del
 * archivo es correcta y no un olvido. El catálogo completo está en el `defaults.json` de
 * `PlatformSettingsService`.
 */
export const SETTINGS_VARS: ReadonlySet<string> = new Set(ENV_VARS.filter((v) => v.source === "platform-settings").map((v) => v.name));
