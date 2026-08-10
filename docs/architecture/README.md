# Arquitectura de ADC Platform

Visión general de cómo funciona la plataforma. Este README cubre el modelo de capas, el flujo de
carga y las responsabilidades; los temas más profundos viven en docs hermanos:

| Tema | Documento |
| ---- | --------- |
| Loaders, versionado semver, multi-lenguaje (IPC), workspaces | [module-system.md](module-system.md) |
| Instancias múltiples, config por instancia, hot reload, docker | [app-runtime.md](app-runtime.md) |
| UI framework-agnostic, Module Federation, namespaces, i18n, SW | [ui-federation.md](ui-federation.md) |
| Arranque: concurrencia acotada, readiness, caché de bundler, flags | [boot-performance.md](boot-performance.md) |
| Códigos HTTP: cuándo `204` vs `404`, etc  (back y front) | [http-status.md](http-status.md) |
| Presets (módulos opcionales en repos git) | [../multirepo.md](../multirepo.md) |

## Componentes

### Kernel

Orquestador central que carga dinámicamente componentes del filesystem. Busca recursivamente
providers, utilities y services en sus directorios. Registra capacidades mediante Symbols para
inyección de dependencias. También ejecuta las Apps. Lógica de carga en [src/core/](../../src/core/).

### Providers (Capa I/O)

Sistemas de almacenamiento, conexiones a bases de datos, APIs externas. Ubicados en `src/providers/`.

### Utilities (Capa Lógica)

Serializadores, validadores, filtros, transformadores. Ubicados en `src/utilities/`.

### Services (Capa Utilidad)

Funcionalidad reutilizable sin lógica de ejecución automática. Pueden ser stateful. Ubicados en
`src/services/`. Pueden tener su propio `config.json` para cargar dependencias.

**Servicios en Modo Kernel:** algunos servicios críticos (como `ExecutionManagerService`) se ejecutan
en modo kernel (`kernelMode` en config.json), lo que los hace disponibles globalmente y se cargan
durante la inicialización del kernel (antes de las apps). `kernelMode` acepta `true` (prioridad 1) o
un número que define el orden de carga — menor carga antes (ej.: `LangManagerService: 10` carga antes
que `IdentityManagerService: 60`). Ver [src/core/services/KernelServiceFinder.ts](../../src/core/services/KernelServiceFinder.ts).

### Apps (Capa Negocio)

Lógica principal que consume Providers, Utilities y Services. Se ejecutan automáticamente. Ubicados
en `src/apps/`. Cada app puede tener un `config.json` para declarar sus módulos específicos. El
comportamiento runtime (instancias múltiples, hot reload, docker) está en [app-runtime.md](app-runtime.md).

### IdentityManagerService

Servicio en modo kernel para gestión centralizada de usuarios, roles, grupos y organizaciones:
roles predefinidos (SYSTEM, Admin, Network/Security/Data/App/Config Manager, User), usuario SYSTEM
auto-creado con credenciales aleatorias por arranque, persistencia en MongoDB (fallback a memoria si
no hay `mongo-provider`), hashing de contraseñas con argon2id (con lectura permanente del formato
PBKDF2 anterior y rehash al iniciar sesión) y permisos granulares por recurso,
acción y alcance (self/group/all). Detalle en [src/services/core/IdentityManagerService/README.md](../../src/services/core/IdentityManagerService/README.md).

## Sistema de Capacidades

Cada componente registra una capacidad (Symbol único) que otros pueden consumir:

```typescript
const storage = kernel.getProvider(STORAGE_PROVIDER);
```

## Flujo de Carga

```
1. Kernel.start()
   ├─ 2. Cargar Servicios en Modo Kernel
   │      └─ ExecutionManagerService, IdentityManagerService, etc.
   │
   ├─ 3. Cargar Providers (recursivo, fallback global)
   ├─ 4. Cargar Utilities (recursivo, fallback global)
   ├─ 5. Cargar Services (recursivo, fallback global)
   │
   └─ 6. Cargar Apps (cada app)
      ├─ 6a. Detectar docker-compose.yml (si existe)
      │      └─ Ejecutar: docker-compose up -d (background)
      │
      └─ 6b. App.loadModulesFromConfig()
         ├─ Lee config.json en el directorio de la app
         ├─ Para cada módulo declarado:
         │  ├─ VersionResolver resuelve versión compatible
         │  ├─ LoaderManager selecciona loader por lenguaje
         │  ├─ Loader importa el módulo
         │  └─ Kernel registra el módulo
         ├─ App.start()
         └─ App.run()
```

Detalle de resolución de versiones y loaders en [module-system.md](module-system.md); detalle de
docker auto-provisioning en [app-runtime.md](app-runtime.md).

## Búsqueda Recursiva

El Kernel busca recursivamente sin límites de profundidad en sus directorios (`providers/`,
`utilities/`, `services/`, `apps/`).

## Ejecución Distribuida (`@Distributed`)

`ExecutionManagerService` es un servicio en modo kernel que gestiona ejecución distribuida:

- **Pool de Workers:** administra workers dinámicamente según la carga del sistema.
- **Monitoreo de Recursos:** mide CPU y memoria para optimizar distribución.
- **Decorador `@Distributed`:** los módulos anotados pueden ejecutarse en workers.
- **Preparado para Clusterización:** arquitectura diseñada para soportar nodos remotos en el futuro.

```typescript
@Distributed
class MyService extends BaseService {
	async heavyComputation() {
		// Se ejecuta en worker si el ExecutionManager lo asigna
	}
}
```

> `@Distributed` **no garantiza** ejecución en worker — `ExecutionManagerService` decide según carga.

## Trabajos de momentos ociosos (`OperationsService`)

Barridos que **nadie está esperando**: verificar contenido ya subido, reconciliar contadores,
purgar. No van en un `setInterval` por módulo — cinco módulos con su propio timer no se coordinan
y en la primera hora punta corren los cinco contra el mismo event loop.

Viven en `OperationsService` junto a la idempotencia (`httpCheck`) y las sagas (`stepper`) porque
los tres resuelven lo mismo: **cuándo** corre el trabajo, no cómo se hace. Uno garantiza que algo
pedido pase una sola vez, otro que una secuencia se complete o se revierta, éste que lo que nadie
pidió todavía se haga sin estorbar. La implementación está desacoplada en
`parts/IdleJobs.ts` (gate por scope + configuración) y `parts/IdleScheduler.ts` (el planificador).

```typescript
// En start(): dependencia OPCIONAL, resuelta por nombre.
this.tryGetMyService<IIdleOrchestrator>("OperationsService")?.registerIdleJob(this.getCapability(), {
	id: "content-verification",
	intervalMs: 300_000,
	run: (ctx) => verifier.runBatch(ctx), // devuelve cuántas unidades procesó
});

// En stop(): el kernel garantiza que se llame al descargar o deshabilitar el módulo.
this.tryGetMyService<IIdleOrchestrator>("OperationsService")?.unregisterIdleJobs(this.getCapability());
```

- Requiere el scope **`idle:register`** en `privileges`. El dueño sale de `cap.owner`: nadie
  registra ni da de baja trabajos ajenos, y registrar dos veces el mismo `id` **reemplaza**.
- El planificador corre **un lote por turno**, sólo con el proceso ocioso, y le pasa una
  `AbortSignal` con presupuesto: hay que mirarla entre unidad y unidad. Devolver `0` espacia el
  trabajo progresivamente.
- **El avance se guarda en la base del dueño** (una marca por documento procesado), no en el
  planificador: es lo que hace reanudable el barrido tras un reinicio.

Contrato en `@common/types/operations/IIdleOrchestrator.ts`; frenos globales en las variables
`IDLE_*` del `.env` de la raíz.

## Distribución de Responsabilidades

### Kernel

- Carga recursiva de `providers/`, `utilities/`, `services/` (fallback global).
- Ejecuta Apps encontradas.
- Registra módulos en el registry central.
- Soporta hot reloading en desarrollo.

### BaseApp

- Responsable de cargar sus propios módulos desde `config.json`.
- Obtiene módulos del kernel después de cargarlos.
- Ejecuta lógica de negocio en `run()`.
- NO declara dependencias estáticas.

### ModuleLoader

- Resuelve versiones según especificadores semver.
- Selecciona loader por lenguaje.
- Carga dinámicamente módulos versionados.
- Pasa configuración al módulo.

## Optimizaciones de Memoria y Rendimiento

- Cada app carga solo los módulos que declara en `config.json`.
- El Kernel mantiene un fallback global para módulos sin versionar.
- `ExecutionManagerService` distribuye carga pesada a workers.
- Menor impacto en memoria en ejecuciones con múltiples apps.
- Preparado para clusterización futura (nodos remotos en lugar de workers).
