# ADC Platform - AI Coding Agent Instructions

## Architecture Overview

ADC Platform is a **modular kernel system** that dynamically loads four types of modules from the filesystem:

- **Providers** (I/O layer): Storage, databases, HTTP servers - in `src/providers/`
- **Utilities** (Logic layer): Serializers, validators, transformers - in `src/utilities/`
- **Services** (Reusable logic): Stateful functionality without auto-execution - in `src/services/`
- **Apps** (Business logic): Auto-executing applications consuming other modules - in `src/apps/`

The **Kernel** (`src/kernel.ts`) orchestrates everything via recursive filesystem loading, Symbol-based dependency injection through `ModuleRegistry`, and supports hot-reloading in development.

## Critical Patterns

### Module Base Classes & Lifecycle

All modules extend base classes with required lifecycle hooks:

- `BaseApp` → implements `start()` and `run()` (business logic goes in `run()`)
- `BaseService` → inherits `start()`/`stop()` with initialization guards
- `BaseProvider` → lightweight lifecycle, uses `@OnlyKernel()` decorator
- `BaseUtility` → similar to `BaseProvider`

```typescript
// Example App structure
export default class MyApp extends BaseApp {
	async run() {
		// Business logic here - called after start()
		const storage = this.getMyProvider<FileStorage>("file-storage");
	}
}
```

### Module Configuration Pattern

Every module directory follows npm workspace structure:

- `package.json` - Declares dependencies (npm installs them separately per module)
- `config.json` or `default.json` - Declares module dependencies (providers/utilities/services)
- `README.md` - Brief documentation (max 15 lines, avoid redundancy)

**Apps support multiple instances**: Place `config-*.json` files in app root or `configs/` subdirectory. Each creates a separate instance with format `app-name:config-suffix`.

```json
// Example config.json
{
	"failOnError": false,
	"providers": [{ "name": "mongo", "global": true, "custom": { "uri": "..." } }],
	"services": [{ "name": "IdentityManagerService", "version": "latest" }]
}
```

### Dependency Injection

Access modules via Kernel methods, **not** direct imports. Providers are referenced by **name**, not by type:

```typescript
// In Apps: Use getMyProvider() to get YOUR configured instance
this.getMyProvider<MongoProvider>("mongo");

// In Services/Providers: Use kernel directly
this.kernel.getService<IdentityManagerService>("IdentityManagerService");
this.kernel.getProvider<FileStorage>("file-storage");
```

### UI Apps Pattern (Module Federation)

UI apps use **UIFederationService** for micro-frontend architecture:

- Configure via `uiModule` section in `config.json`
- Framework support: Astro, React, Vue, Vanilla
- Module Federation: `isHost` (consumes remotes) vs `isRemote` (exposes components)
- `uiDependencies` ensures load order (e.g., UI libraries load first)
- **Namespace isolation**: `uiNamespace` separates i18n translations and app contexts (`adc-platform`, `default`, `mobile`)

**Deployment modes**:

- `bun run dev`: Apps serve on individual ports via `devPort` in config
- `bun run start`/`start:prodtests`: All apps serve via subdomain routing (`hosting.subdomains` in config)

**Service Worker pattern**: Only enable `serviceWorker: true` in **layout apps** - it automatically works for all their child apps without re-enabling.

```typescript
// UI app main.tsx pattern
import "@ui-library"; // Auto-registers Web Components
import "@ui-library/styles"; // Base CSS variables
import "./styles/tailwind.css"; // Local extensions only
```

### Distributed Execution

Use `@Distributed` decorator on Services to enable worker-based execution:

```typescript
@Distributed
class HeavyService extends BaseService {
	async processData(data: any) {
		// ExecutionManagerService may route this to a worker thread
	}
}
```

### Kernel-Mode Services

Services with `kernelMode` in their `config.json` load during kernel startup (before apps). The value can be `true` (priority 1) or a number defining load order — lower loads first (e.g. `LangManagerService: 10` loads before `IdentityManagerService: 60`). Examples:

- **ExecutionManagerService**: Manages worker pool for distributed execution
- **IdentityManagerService**: User/role/group management with PBKDF2 hashing, MongoDB persistence

### Docker Compose Auto-Provisioning

If an app directory contains `docker-compose.yml`, the Kernel automatically runs `docker-compose up -d` before starting the app. Use this for MongoDB, Redis, etc.

## Development Workflows

### Commands (see `package.json`)

> **Usar `bun` como runtime/package manager** (no `npm`): `bun run dev`, `bun install`, etc.

```bash
bun run dev              # Development with hot-reload + test apps (individual ports)
bun run start            # Production mode (port 80, no test apps, subdomain routing)
bun run start:prodtests  # Production mode with test apps (port 3000, subdomain routing)
bun run lint             # ESLint check with zero warnings
bun run typecheck        # Recursive TypeScript check + knip unused exports
bun run build:ui         # Compile Stencil UI library (check for build errors)
bun run cleanup          # Kill orphaned processes
```

> ⚠️ **Never run `tsgo`/`tsc -p <tsconfig>` without `--noEmit`.** The module
> `tsconfig.json` files do NOT set `noEmit`, so a bare `tsgo -p ...` emits
> hundreds of `.js`/`.d.ts` files next to the `.ts`/`.tsx` sources (and into
> referenced `src/common/**`), polluting the tree. To validate types, use
> `bun run typecheck` (the official `scripts/recursive-typecheck.sh` already
> passes `--noEmit`) or, for a scoped check, `npx tsgo -p <module>/tsconfig.json --noEmit`.
> To test/run a module, use the node scripts above — never hand-compile.

### Creating Modules

**Before creating a new service or UI app from scratch, read `docs/structure/README.md`** — it indexes the standard templates (models, DAOs, endpoints, service shell, frontend apps, enterprise apps).

Use scaffolding scripts:

```bash
bun run create:app -- my-app           # Creates src/apps/my-app/
bun run create:service -- my-service   # Creates src/services/my-service/
bun run create:provider -- my-provider # Creates src/providers/my-provider/
bun run create:utility -- my-utility   # Creates src/utilities/my-utility/
```

### Hot Reload Behavior

- **Code changes**: Module reloads automatically
- **Config changes**: Only affected app instance reloads
- **New config file**: New app instance spawns
- **Delete config**: Instance stops and removes

## Code Conventions

### Principles

Follow **KISS, DRY, SOLID, YAGNI** - stated explicitly in `CLAUDE.md`.

### File Structure

- TypeScript files use `.ts` extension (`.js` imports include `.js` extension due to ESM)
- Each module is self-contained workspace (no shared dependencies)
- Recursive loading means subdirectories work automatically

### Decorators

- `@OnlyKernel()`: Restricts method calls to kernel-provided Symbol (security)
- `@Distributed`: Enables ExecutionManagerService worker routing

### Logging

Use inherited logger from base classes:

```typescript
this.logger.logInfo("Message");
this.logger.logError("Error");
this.logger.logDebug("Debug info");
this.logger.logOk("Success");
```

### Documentation

- Each module's `README.md`: **max 15 lines**, purpose + key features only
- `config.json` is self-documenting for dependencies
- Don't create redundant centralized docs
- Update module's own README when modifying it

## Key Integration Points

### Symbol-Based Registry

`ModuleRegistry` uses Symbol keys for capability registration:

```typescript
const STORAGE_PROVIDER = Symbol("storage-provider");
kernel.registerProvider("file-storage", instance, config);
```

### Version Resolution

`VersionResolver` handles semver ranges (e.g., `^1.0.0`, `>=1.2.0`) when loading modules.

## Common Gotchas

1. **Config vs Modules**: `config.json` declares dependencies, `package.json` declares npm packages
2. **Global Providers**: Set `"global": true` in provider config to share across app instances
3. **Provider Reference**: Access providers by **name** (e.g., `"mongo"`, `"file-storage"`), not by type
4. **UI Library Imports**: Always import UI library BEFORE local styles to ensure CSS variable availability
5. **Service Worker**: Only enable in layout apps - automatically cascades to child apps
6. **Dev vs Prod Deployment**: Dev uses individual ports (`devPort`), production uses subdomain routing
7. **Worker Assignment**: `@Distributed` doesn't guarantee worker execution - ExecutionManagerService decides based on load
8. **Instance Names**: App instances follow `{appName}:{configSuffix}` format (e.g., `user-profile:main`)
9. **Stencil `shadow: false` + React root swaps**: Stencil components with `shadow: false` (like `adc-layout`, `adc-feature-card`, `adc-skeleton`) physically reposition slotted children. Never render such a component in `main.tsx` wrapping `<App />`, and never return different top-level JSX nodes across renders inside them — React's reconciler will throw `NotFoundError: removeChild` on unmount. Put `<adc-layout>` inside `App.tsx` as a stable root, or wrap branches with distinct `key` props to force full remount.

## Reference Files

- **Kernel orchestration**: `src/kernel.ts` (loading logic in `src/core/`)
- **App base class**: `src/apps/BaseApp.ts`
- **Service base**: `src/services/BaseService.ts`
- **Provider base**: `src/providers/BaseProvider.ts`
- **Module config interface**: `src/interfaces/modules/IModule.d.ts`
- **UI Federation**: `src/services/core/UIFederationService/`
- **Identity system**: `src/services/core/IdentityManagerService/`
- **Session management**: `src/services/security/SessionManagerService/`
- **Main UI Library**: `src/apps/public/00-adc-ui-library/` (includes components for building public apps, and utils for Connect RPC, router, autogenerated React JSX, Tailwind preset)
- **Architecture docs**: `docs/architecture/` (índice general en `docs/README.md`), `README.md`, `CLAUDE.md`
