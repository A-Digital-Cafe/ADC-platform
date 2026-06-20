# Service shell — Plantilla para crear un servicio

Este documento define cómo ensamblar un servicio nuevo: el `index.ts` que une models, DAOs y endpoints, y el `config.json` que declara sus dependencias. Complementa `models.md`, `daos.md` y `endpoints.md`. Para el versionado/lenguaje y la resolución de dependencias del `config.json`, ver [architecture/module-system.md](../../architecture/module-system.md); para instancias múltiples, hot reload y `kernelMode`, ver [architecture/app-runtime.md](../../architecture/app-runtime.md). Referencia real: `presets/project-management/services/ProjectManagerService/`.

## Estructura completa

```text
src/services/<layer>/<MyService>/
├── config.json          # Dependencias del servicio (providers/utilities/services)
├── package.json         # Dependencias npm (workspace propio)
├── README.md            # Máx 15 líneas
├── domain/              # Schemas Mongoose (ver models.md)
├── dao/                 # Managers de recursos (ver daos.md)
├── endpoints/           # Capa HTTP (ver endpoints.md)
└── index.ts             # El shell: clase BaseService
```

## config.json

```json
{
	"name": "MyService",
	"version": "1.0.0",
	"failOnError": false,
	"providers": [
		{
			"name": "object/mongo",
			"version": "latest",
			"custom": { "uri": "mongodb://admin:password@localhost:27017/my-db?authSource=admin" }
		}
	],
	"utilities": [{ "name": "attachments/attachments-utility", "version": "latest" }],
	"services": [
		{ "name": "IdentityManagerService", "version": "latest" },
		{ "name": "EndpointManagerService", "version": "latest" }
	],
	"private": { "someProjectId": "${MY_ENV_VAR}" }
}
```

- `${VAR}` y `${VAR:-default}` se interpolan desde el `.env` propio del servicio. La interpolación es de un solo nivel: **no** anidar (`${A:-${B}}` no funciona). Para fallbacks entre vars, declarar cada una como su propia clave en `private` y resolver la prioridad en código (ej. `config.supportTicketsProjectId || config.orgManagementProjectId`).
- `private` es configuración interna accesible vía `this.config?.private`.
- **Nunca leer `process.env` en el código del servicio** (DAOs, endpoints, index). Las variables de entorno se declaran en `config.json` (interpoladas en `private` o en `custom` de un provider) y se documentan en el `.env.example` del servicio. Excepción: flags de runtime de la plataforma (`NODE_ENV`, `PROD_PORT`) que maneja `BaseService`/el kernel, no el módulo.
- Si el servicio debe cargar **antes que las apps**, agregar `"kernelMode": true` (prioridad 1) o un número que define el orden de carga — menor carga antes (ej. `LangManagerService: 10` antes que `IdentityManagerService: 60`).

## index.ts — contrato base

```ts
export default class MyService extends BaseService {
	public readonly name = "MyService";

	#resourceManager: ResourceManager | null = null;
	#authVerifier: IAuthVerifier | null = null;
	#identity: IdentityManagerService | null = null;
	private mongoProvider!: MongoProvider;

	readonly #getAuthVerifier: AuthVerifierGetter = () => this.#authVerifier;

	@EnableEndpoints({ managers: () => [ResourceEndpoints, OperationEndpoints] })
	async start(kernelKey: symbol): Promise<void> {
		await super.start(kernelKey);

		// 1. Providers declarados en config.json
		this.mongoProvider = this.getMyProvider<MongoProvider>("object/mongo");
		await this.waitForMongo();

		// 2. Servicios de los que depende
		this.#identity = this.kernel.registry.getService<IdentityManagerService>("IdentityManagerService");
		this.#authVerifier = this.#identity.createAuthVerifier();

		// 3. Models (ver models.md) — el servicio es dueño de su creación
		const ResourceModel = this.mongoProvider.createModel<Resource>("resources", resourceSchema);

		// 4. Managers (ver daos.md)
		this.#resourceManager = new ResourceManager(ResourceModel, this.logger, this.#getAuthVerifier);

		// 5. Endpoints (ver endpoints.md)
		ResourceEndpoints.init(this, kernelKey);
		OperationEndpoints.init(this, kernelKey);

		this.logger.logOk("MyService iniciado");
	}

	get resources(): ResourceManager {
		if (!this.#resourceManager) throw new Error("ResourceManager not initialized");
		return this.#resourceManager;
	}

	@DisableEndpoints()
	async stop(kernelKey: symbol): Promise<void> {
		await super.stop(kernelKey);
		this.#authVerifier = null;
	}
}
```

Reglas:

- `start()` SIEMPRE llama `await super.start(kernelKey)` primero (carga providers/utilities del `config.json`).
- `@EnableEndpoints({ managers: () => [...] })` en `start()` registra las clases de endpoints; `@DisableEndpoints()` en `stop()` las desregistra.
- Los managers se exponen mediante getters que lanzan error si no están inicializados. Los endpoints acceden vía `service.resources`, nunca a los models.
- El `kernelKey` recibido en `start()` es el que se pasa a `Endpoints.init(this, kernelKey)` y a los managers que exponen internals.

## Métodos del servicio para los endpoints

Los cálculos de contexto compartidos entre endpoints (caller, roles, flags) viven en el servicio, protegidos con `@OnlyKernel()` y cacheados sobre `ctx`:

```ts
@OnlyKernel()
async resolveCaller(_kernelKey: symbol, ctx: EndpointCtx): Promise<CallerCtx> {
	const cacheKey = Symbol.for("MyServiceCallerCtx");
	const cached = (ctx as any)[cacheKey];
	if (cached) return cached;

	const caller = { userId: ctx.user?.id ?? "", groupIds: [] };
	Object.defineProperty(ctx, cacheKey, { value: caller, enumerable: false });
	return caller;
}
```

## Dependencias opcionales y degradación

Si una capacidad secundaria (attachments, comments, colas) puede faltar, inicializarla en `try/catch`, loguear `logWarn` y hacer que su getter lance un error tipado `503` (`*_UNAVAILABLE`). El servicio arranca igual; solo fallan los endpoints relacionados.

```ts
get attachments(): AttachmentsManager {
	if (!this.#attachmentsManager)
		throw new MyServiceError(503, "ATTACHMENTS_UNAVAILABLE", "Attachments no disponibles");
	return this.#attachmentsManager;
}
```

## Esperas de infraestructura

Si el provider tarda en conectar, esperar con timeout duro en vez de fallar al primer intento:

```ts
private async waitForMongo(): Promise<void> {
	const maxWaitTime = 10000;
	const startTime = Date.now();
	while (!this.mongoProvider.isConnected() && Date.now() - startTime < maxWaitTime) {
		await new Promise((resolve) => setTimeout(resolve, 500));
	}
	if (!this.mongoProvider.isConnected()) throw new Error("MongoDB no pudo conectarse en el tiempo esperado");
}
```

## Checklist de creación

- [ ] `config.json` declara name, version, providers, utilities y services reales.
- [ ] Env vars vía `config.json` (sin `process.env` en el código) y documentadas en `.env.example` del servicio.
- [ ] `kernelMode` solo si otros módulos lo necesitan antes de que carguen las apps.
- [ ] `start()` llama `super.start()` y sigue el orden providers → servicios → models → managers → endpoints.
- [ ] `@EnableEndpoints` en `start()` y `@DisableEndpoints` en `stop()`.
- [ ] Managers expuestos con getters defensivos; nunca se exponen models.
- [ ] Contexto compartido en métodos `@OnlyKernel()` cacheados sobre `ctx`.
- [ ] Capacidades opcionales degradan a `503` tipado sin impedir el arranque.
- [ ] `README.md` del servicio creado/actualizado (máx 15 líneas).
