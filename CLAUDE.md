# ADC Platform

Kernel modular con carga dinámica de apps, services, providers y utilities.
Utilizar patrones KISS, DRY, SOLID y YAGNI.

## Estructura

```
src/
├── kernel.ts          # Orquestador central (lógica de carga en src/core/)
├── apps/              # Aplicaciones (cada una con README.md)
│   ├── public/        # Apps públicas (adc-platform namespace)
│   └── test/          # Apps de desarrollo (default namespace)
├── services/          # Servicios (core/, data/, security/; cada uno con README.md)
├── providers/         # Proveedores (http/, object/, queue/, ...; cada uno con README.md)
├── utilities/         # Utilidades reutilizables
├── common/            # Tipos y utilidades compartidas (@common)
└── utils/             # Helpers internos
presets/               # Módulos opcionales en repos git propios (ver docs/multirepo.md)
docs/                  # Documentación on-demand (índice: docs/README.md)
```

## Commands

> **Usar `bun` como runtime/package manager** (no `npm`): `bun run dev`, `bun install`, etc.

| Command | Description |
| ------- | ----------- |
| `bun run dev` | Desarrollo (hot reload) |
| `bun run start:prodtests` | Simular producción + tests habilitados |
| `bun run start` | Producción (puerto 80) |
| `bun run typecheck` | TypeScript check + knip unused exports |
| `bun run extra-checks` | Archivos grandes + knip dependencies sin usar |
| `bun run lint` | ESLint (zero warnings) |
| `bun run lint:fix` | ESLint con auto-fix |
| `bun run build:ui` | Compilar Stencil UI library |
| `bun run proto:gen` | Generar código desde protobuf (buf) |
| `bun run cleanup` | Limpiar procesos |

> `postinstall` corre automáticamente tras `bun install` y sincroniza presets (`scripts/sync-presets.mjs`).

> ⚠️ **Nunca ejecutar `tsgo`/`tsc -p <tsconfig>` sin `--noEmit`.** Los `tsconfig.json` de módulos NO tienen `noEmit`, por lo que un `tsgo -p ...` sin flag emite cientos de `.js`/`.d.ts` junto a los fuentes, contaminando el árbol. Usar `bun run typecheck` o `npx tsgo -p <module>/tsconfig.json --noEmit` para validar tipos.

> ⚠️ **NUNCA trabajar sobre compilados.** No editar NI usar como fuente de verdad nada bajo `temp/` (`temp/ui-builds`, `temp/stencil-cache`, `temp/configs`, ...) ni cualquier `dist`/output generado. Son artefactos de build, se regeneran y no reflejan necesariamente la fuente. Razonar y modificar SIEMPRE desde el código fuente (`src/`, `presets/.../src/`).

## Documentación (cargar on-demand)

Toda la doc situacional vive en `docs/` y se enruta desde un único índice maestro:
**[docs/README.md](docs/README.md)**. Leé el doc relevante **antes** de tocar código; seguilo al pie
de la letra; no dupliques su contenido acá. Puntos de entrada por tarea:

- **Crear o editar un módulo** (app/service/provider/utility): empezá por [docs/structure/README.md](docs/structure/README.md) — plantillas + checklist por capa.
- **Cómo funciona la plataforma**: [docs/architecture/](docs/architecture/README.md) (kernel/carga, módulos/versionado, runtime de apps, UI federation).
- **Presets** (repos git bajo `presets/`): [docs/multirepo.md](docs/multirepo.md).
- **Guías operativas** (Discord OAuth, email/DNS, puertos): [docs/guides/](docs/guides/).

Scaffolding (genera el esqueleto; igual hay que leer la doc de la capa):

```bash
bun run create:app -- my-app
bun run create:service -- my-service
bun run create:provider -- my-provider
bun run create:utility -- my-utility
```

## Module Base Classes & Lifecycle

Todos los módulos extienden clases base con lifecycle hooks:

- `BaseApp` → implementa `start()` y `run()` (lógica de negocio en `run()`)
- `BaseService` → hereda `start()`/`stop()` con guards de inicialización
- `BaseProvider` → lifecycle ligero, usa `@OnlyKernel()` decorator
- `BaseUtility` → similar a `BaseProvider`

```typescript
export default class MyApp extends BaseApp {
	async run() {
		const storage = this.getMyProvider<FileStorage>("file-storage");
	}
}
```

## Module Configuration Pattern

Cada directorio de módulo sigue estructura npm workspace:

- `package.json` — dependencias npm (instaladas por separado por módulo)
- `config.json` o `default.json` — declara dependencias de módulos (providers/utilities/services)
- `README.md` — documentación breve (máx 15 líneas)

Las apps soportan **múltiples instancias** vía archivos `config-*.json` (instancia `app-name:config-suffix`); detalle en [docs/architecture/app-runtime.md](docs/architecture/app-runtime.md).

```json
{
	"failOnError": false,
	"providers": [{ "name": "mongo", "global": true, "custom": { "uri": "..." } }],
	"services": [{ "name": "IdentityManagerService", "version": "latest" }]
}
```

## Dependency Injection

Acceder a módulos via métodos del Kernel, **no** imports directos. Providers se referencian por **nombre**, no por tipo:

```typescript
// En Apps: getMyProvider() para obtener TU instancia configurada
this.getMyProvider<MongoProvider>("mongo");

// En Services/Providers: usar kernel directamente
this.kernel.getService<IdentityManagerService>("IdentityManagerService");
this.kernel.getProvider<FileStorage>("file-storage");
```

## Key Concepts

| Concepto | Descripción |
| -------- | ----------- |
| `config.json` | Dependencias y configuración del módulo |
| `uiDependencies` | Apps UI que deben cargarse antes |
| `@ui-library` | Auto-registra Web Components al importarse |
| `@ui-library/styles` | CSS base de la UI Library |
| `uiNamespace` | Aísla UI libraries (ej: `adc-platform`, `default`) |
| `@Distributed` | Decorador para ejecutar en worker (no garantiza worker; decide `ExecutionManagerService`) |
| `kernelMode` | Carga el servicio durante startup del kernel (antes de apps) |
| `"global": true` | Comparte un provider entre instancias de la app |

## Code Conventions

- Archivos TypeScript usan extensión `.ts` (imports `.js` incluyen extensión `.js` por ESM)
- Cada módulo es workspace auto-contenido (sin dependencias compartidas)
- `@OnlyKernel()`: Restringe llamadas de métodos al Symbol provisto por el kernel (seguridad)
- Helpers reutilizables (escaping, paginación por cursor, crypto, …) viven en `@common/utils` — no los reimplementes por módulo
- Tipos compartidos en `@common/types/<domain>/`; errores tipados en `@common/types/custom-errors/`
- Imports que escapan de un módulo usan aliases (`@common`, `@services`, `@providers`, `@utilities`, `@interfaces`, `@kernel`); imports internos relativos

**Logging** (usar logger heredado de las clases base):

```typescript
this.logger.logInfo("Message");
this.logger.logError("Error");
this.logger.logDebug("Debug info");
this.logger.logOk("Success");
```

## Common Gotchas

1. **Config vs Modules**: `config.json` declara dependencias, `package.json` declara paquetes npm
2. **Global Providers**: Set `"global": true` en config del provider para compartir entre instancias
3. **Provider Reference**: Acceder providers por **nombre** (ej: `"mongo"`, `"file-storage"`), no por tipo

> Gotchas específicos de UI (Stencil `shadow: false`, React 19 + custom elements, orden de imports) en [docs/architecture/ui-federation.md](docs/architecture/ui-federation.md).

## Documentation Rules

- Cada módulo tiene su propio `README.md` (máx 15 líneas)
- `config.json` documenta dependencias
- NO crear documentación centralizada redundante ni documentar lo obvio
- Al modificar un módulo, actualizar SU readme si es necesario
- Al agregar un doc nuevo, enlazarlo desde el índice de su categoría (no desde este archivo): `docs/structure/README.md`, `docs/architecture/README.md` o `docs/guides/`

## Reference Files

- **Kernel**: [src/kernel.ts](src/kernel.ts) (lógica de carga en [src/core/](src/core/))
- **App base**: [src/apps/BaseApp.ts](src/apps/BaseApp.ts)
- **Service base**: [src/services/BaseService.ts](src/services/BaseService.ts)
- **Provider base**: [src/providers/BaseProvider.ts](src/providers/BaseProvider.ts)
- **Module config interface**: [src/interfaces/modules/IModule.d.ts](src/interfaces/modules/IModule.d.ts)
- **UI Federation**: [src/services/core/UIFederationService/](src/services/core/UIFederationService/)
- **Identity system**: [src/services/core/IdentityManagerService/](src/services/core/IdentityManagerService/)
- **Session management**: [src/services/security/SessionManagerService/](src/services/security/SessionManagerService/)
- **Main UI Library**: [src/apps/public/00-adc-ui-library/](src/apps/public/00-adc-ui-library/) (components, Connect RPC utils, router, React JSX autogenerado, Tailwind preset)
