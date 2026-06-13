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
```

## Commands

> **Usar `bun` como runtime/package manager** (no `npm`): `bun run dev`, `bun install`, etc.

| Command | Description |
| ------- | ----------- |
| `bun run dev` | Desarrollo (hot reload) |
| `bun run start:prodtests` | Simular producción + tests habilitados |
| `bun run start` | Producción (puerto 80) |
| `bun run typecheck` | TypeScript check + knip unused exports |
| `bun run lint` | ESLint (zero warnings) |
| `bun run build:ui` | Compilar Stencil UI library |
| `bun run cleanup` | Limpiar procesos |

> ⚠️ **Nunca ejecutar `tsgo`/`tsc -p <tsconfig>` sin `--noEmit`.** Los `tsconfig.json` de módulos NO tienen `noEmit`, por lo que un `tsgo -p ...` sin flag emite cientos de `.js`/`.d.ts` junto a los fuentes, contaminando el árbol. Usar `npm run typecheck` o `npx tsgo -p <module>/tsconfig.json --noEmit` para validar tipos.

> ⚠️ **NUNCA trabajar sobre compilados.** No editar NI usar como fuente de verdad nada bajo `temp/` (`temp/ui-builds`, `temp/stencil-cache`, `temp/configs`, ...) ni cualquier `dist`/output generado. Son artefactos de build, se regeneran y no reflejan necesariamente la fuente. Razonar y modificar SIEMPRE desde el código fuente (`src/`, `presets/.../src/`).

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

**Apps soportan múltiples instancias**: colocar archivos `config-*.json` en el root del app o en `configs/`. Cada uno crea una instancia separada con formato `app-name:config-suffix`.

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
| `@Distributed` | Decorador para ejecutar en worker |
| `kernelMode` | Carga el servicio durante startup del kernel (antes de apps) |
| `"global": true` | Comparte un provider entre instancias de la app |

## UI Apps (Module Federation)

UI apps usan **UIFederationService** para arquitectura micro-frontend:

- `isHost` — consume remotes; `isRemote` — expone componentes
- `uiNamespace` — aísla i18n translations y app contexts
- Service Worker: habilitar solo en **layout apps** — cascadea automáticamente a apps hijas

**Modos de despliegue:**
- `bun run dev`: Apps en puertos individuales via `devPort` en config
- `bun run start`/`start:prodtests`: Todas via subdomain routing (`hosting.subdomains` en config)

**Configuración de hosting en `config.json`:**

```json
{
	"uiModule": {
		"hosting": {
			"hosts": [{ "domain": "local.com", "subdomains": ["cloud", "users", "*"] }]
		}
	}
}
```

```typescript
// main.tsx - Patrón de imports
import "@ui-library"; // Auto-registra Web Components
import "@ui-library/styles"; // CSS base (variables, tipografía, etc.)
import "./styles/tailwind.css"; // Extensiones locales (solo Tailwind + extensiones propias)
```

## Distributed Execution

```typescript
@Distributed
class HeavyService extends BaseService {
	async processData(data: any) {
		// ExecutionManagerService puede rutear esto a un worker thread
	}
}
```

`@Distributed` no garantiza ejecución en worker — `ExecutionManagerService` decide según carga.

## Kernel-Mode Services

Servicios con `kernelMode` en `config.json` cargan durante el startup del kernel (antes de las apps). El valor puede ser `true` (prioridad 1) o un número que define el orden de carga — menor carga primero (ej: `LangManagerService: 10` carga antes que `IdentityManagerService: 60`).

## Docker Compose Auto-Provisioning

Si un directorio de app contiene `docker-compose.yml`, el Kernel ejecuta automáticamente `docker-compose up -d` antes de iniciar la app.

## Crear o editar módulos: leer la doc ANTES de tocar código

Antes de **crear o editar** una app o service, leé [docs/structure/README.md](docs/structure/README.md): rutea —por capa o tarea— al doc con la plantilla + checklist a seguir, e indica el orden de lectura. Para crear, extraer o instalar presets (repos git bajo `presets/`): [docs/multirepo.md](docs/multirepo.md). No dupliques el contenido de esas docs acá; leelas on-demand. (Las docs nuevas se enlazan desde el README, no desde este archivo.)

Scaffolding (genera el esqueleto; igual hay que leer la doc de la capa):

```bash
bun run create:app -- my-app
bun run create:service -- my-service
bun run create:provider -- my-provider
bun run create:utility -- my-utility
```

## Hot Reload Behavior

- **Cambios de código**: El módulo recarga automáticamente
- **Cambios en config**: Solo recarga la instancia de app afectada
- **Nuevo archivo config**: Nueva instancia de app se crea
- **Eliminar config**: La instancia se detiene y elimina

## Code Conventions

- Archivos TypeScript usan extensión `.ts` (imports `.js` incluyen extensión `.js` por ESM)
- Cada módulo es workspace auto-contenido (sin dependencias compartidas)
- `@OnlyKernel()`: Restringe llamadas de métodos al Symbol provisto por el kernel (seguridad)

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
4. **UI Library Imports**: Importar siempre UI library ANTES de estilos locales para asegurar disponibilidad de variables CSS
5. **Service Worker**: Solo habilitar en layout apps — cascadea automáticamente a apps hijas
6. **Dev vs Prod**: Dev usa puertos individuales (`devPort`), producción usa subdomain routing
7. **Worker Assignment**: `@Distributed` no garantiza ejecución en worker — `ExecutionManagerService` decide según carga
8. **Instance Names**: Instancias de app siguen formato `{appName}:{configSuffix}` (ej: `user-profile:main`)
9. **Stencil `shadow: false` + React root swaps**: Componentes Stencil con `shadow: false` (como `adc-layout`, `adc-feature-card`, `adc-skeleton`) reposicionan físicamente los slotted children. Nunca renderizar tal componente en `main.tsx` envolviendo `<App />`, y nunca retornar nodos JSX top-level diferentes entre renders dentro de ellos — el reconciler de React lanzará `NotFoundError: removeChild` al unmount. Colocar `<adc-layout>` dentro de `App.tsx` como root estable, o envolver ramas con `key` props distintas para forzar remount completo.
10. **React 19 sincroniza props de custom elements durante el bubbling**: al abrir un popover/menú desde un handler de evento React (ej: `onContextMenu` que setea `open=true` en un web component Stencil), React 19 fija la prop síncronamente y el MISMO evento sigue burbujeando. Un listener `@Listen("<evento>", { target: "document" })` que cierra "al hacer click/contextmenu afuera" verá `open=true` y lo cerrará en el mismo gesto (abre y cierra al instante). Cerrar con un evento distinto al de apertura (ej: abrir en `contextmenu`, cerrar en `mousedown` — que precede al `contextmenu`). Ver `adc-context-menu`.

## Documentation Rules

- Cada módulo tiene su propio `README.md` (máx 15 líneas)
- `config.json` documenta dependencias
- NO crear documentación centralizada redundante ni documentar lo obvio
- Al modificar un módulo, actualizar SU readme si es necesario

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
