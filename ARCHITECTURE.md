# Arquitectura de ADC Platform

## Componentes

### Kernel

Orquestador central que carga dinámicamente componentes del filesystem. Busca recursivamente providers, utilities y services en sus directorios. Registra capacidades mediante Symbols para inyección de dependencias. También ejecuta las Apps.

### Providers (Capa I/O)

Sistemas de almacenamiento, conexiones a bases de datos, APIs externas. Ubicados en `src/providers/`.

### Utilities (Capa Lógica)

Serializadores, validadores, filtros, transformadores. Ubicados en `src/utilities/`.

### Services (Capa Utilidad)

Funcionalidad reutilizable sin lógica de ejecución automática. Pueden ser stateful. Ubicados en `src/services/`. Pueden tener su propio `config.json` para cargar dependencias.

**Servicios en Modo Kernel:** Algunos servicios críticos (como `ExecutionManagerService`) se ejecutan en modo kernel (`kernelMode` en config.json), lo que los hace disponibles globalmente y se cargan durante la inicialización del kernel. `kernelMode` acepta `true` (prioridad 1) o un número que define el orden de carga — menor carga antes (ej.: `LangManagerService: 10` carga antes que `IdentityManagerService: 60`). Ver `src/core/services/KernelServiceFinder.ts`.

### Apps (Capa Negocio)

Lógica principal que consume Providers, Utilities y Services. Se ejecutan automáticamente. Ubicados en `src/apps/`. Cada app puede tener un `config.json` para declarar sus módulos específicos.

### Instancias Múltiples de Apps

Es posible crear múltiples instancias de una misma aplicación proporcionando diferentes archivos de configuración. El Kernel buscará archivos de configuración en dos ubicaciones dentro del directorio de una aplicación:

1.  **Directorio Raíz de la App**: Archivos `config.json` o `config-*.json` en la raíz del directorio de la app.
2.  **Directorio `configs`**: Archivos `config.json` o `config-*.json` dentro de un subdirectorio llamado `configs`.

Por cada archivo de configuración encontrado, el Kernel creará una nueva instancia de la aplicación. El nombre de la instancia combina el nombre de la app y el sufijo del archivo de configuración: el prefijo `config-` se elimina, y un `config.json` plano genera el sufijo `default` (ver `src/core/apps/AppFileUtils.ts`).

Por ejemplo, para una aplicación llamada `user-profile`, la siguiente estructura de archivos creará tres instancias:

```
src/apps/user-profile/
├── index.ts
├── config-main.json
└── configs/
    ├── config-web.json
    └── config-api.json
```

Las instancias creadas serán:

-   `user-profile:main`
-   `user-profile:web`
-   `user-profile:api`

Cada instancia recibirá su propia configuración y se ejecutará de forma independiente. Esto permite, por ejemplo, tener la misma lógica de aplicación conectada a diferentes bases de datos o con diferentes parámetros de funcionamiento.

### Configuración de Módulos por Instancia

Los archivos de configuración de instancia (e.g., `config-main.json`) también pueden contener una sección `modules`. Esta sección permite definir dependencias y configuraciones de módulos específicas para cada instancia de la aplicación.

### Loaders (Sistema Modular)

Sistema de carga de módulos con soporte para:

-   Versionado semántico
-   Múltiples lenguajes (TypeScript, Python)
-   Interoperabilidad cross-language via IPC (named pipes)

### ExecutionManagerService (Distribución de Carga)

Servicio en modo kernel que gestiona la ejecución distribuida:

-   **Pool de Workers:** Administra workers dinámicamente según la carga del sistema
-   **Monitoreo de Recursos:** Mide CPU y memoria para optimizar distribución
-   **Decorador @Distributed:** Los módulos anotados pueden ejecutarse en workers
-   **Preparado para Clusterización:** Arquitectura diseñada para soportar nodos remotos en el futuro

**Uso:**

```typescript
@Distributed
class MyService extends BaseService {
	async heavyComputation() {
		// Se ejecuta en worker si el ExecutionManager lo asigna
	}
}
```

### IdentityManagerService (Gestión de Identidades)

Servicio en modo kernel para gestión centralizada de usuarios, roles y grupos:

-   **8 Roles Predefinidos:** SYSTEM, Admin, Network Manager, Security Manager, Data Manager, App Manager, Config Manager, User
-   **Usuario SYSTEM:** Auto-creado con credenciales aleatorias en cada arranque (solo disponible durante la sesión)
-   **Persistencia en MongoDB:** Cuando el mongo-provider está disponible (fallback a memoria en caso contrario)
-   **Seguridad:** Contraseñas hasheadas con PBKDF2 (100,000 iteraciones) y salt de 16 bytes
-   **Permisos Granulares:** Por recurso, acción y alcance (self/group/all)
-   **Roles Personalizados:** Posibilidad de crear nuevos roles con permisos específicos

**Alerta de Configuración:**
Si MongoDB no está configurado en las apps, el servicio muestra una alerta:

```
⚠️  MongoDB no está configurado. IdentityManagerService funcionará con datos en memoria.
```

**Ejemplo de Configuración en App:**

```json
{
	"providers": [
		{
			"name": "mongo",
			"global": true,
			"custom": {
				"uri": "mongodb://admin:password@localhost:27017/db-name"
			}
		}
	]
}
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

## Sistema de Capacidades

Cada componente registra una capacidad (Symbol único) que otros pueden consumir:

```typescript
const storage = kernel.getProvider(STORAGE_PROVIDER);
```

## Búsqueda Recursiva

El Kernel busca recursivamente sin límites de profundidad en sus directorios (`providers/`, `utilities/`, `services/`, `apps/`).

## Hot Reloading

En desarrollo (`NODE_ENV=development`) el Kernel observa cambios y recarga componentes automáticamente.

### Hot Reload de Archivos de Configuración

El Kernel también detecta cambios en los archivos de configuración JSON de las apps y recarga automáticamente **solo la instancia específica** asociada a ese archivo, sin afectar otras instancias de la misma app.

**Funcionalidades:**

-   **Cambio de archivo de configuración**: Cuando editas un archivo `config*.json` de una app, solo se reinicia la instancia correspondiente a ese archivo.
-   **Nuevo archivo de configuración**: Al agregar un nuevo archivo de configuración, se crea automáticamente una nueva instancia de la app.
-   **Eliminación de archivo de configuración**: Al eliminar un archivo de configuración, se detiene y remueve la instancia correspondiente.

**Ejemplo:**

Si tienes estas instancias corriendo:

-   `user-profile:main` (usando `config-main.json`)
-   `user-profile:secondary` (usando `config-secondary.json`)

Y editas `config-main.json`, solo se reiniciará la instancia `user-profile:main`, manteniendo `user-profile:secondary` ejecutándose sin interrupciones.

## Provisioning Automático con Docker Compose

El Kernel detecta automáticamente archivos `docker-compose.yml` en las apps y los ejecuta antes de iniciar la aplicación:

**Funcionalidades:**

-   Si una app contiene `docker-compose.yml`, el Kernel ejecuta `docker-compose up -d` al cargar la app
-   Los servicios se inician en background y el Kernel espera 3 segundos para estabilización
-   Si docker-compose falla o no está disponible, continúa sin error (degradación graciosa)
-   Recomendado para apps que requieren servicios como MongoDB, Redis, etc.

**Ejemplo:**

```
src/apps/test/user-profile/
├── index.ts
├── default.json
└── docker-compose.yml          # ← Se ejecuta automáticamente
```

**Antes del Arranque:**

```
1. Kernel detecta docker-compose.yml
2. Ejecuta: docker-compose -f docker-compose.yml up -d
3. Espera 3 segundos para estabilización
4. Continúa cargando la app
```

## Sistema de Versionado

El sistema soporta versionado semántico con el patrón: `{moduleName}/{version}-{language}/`

### Estructura de Módulos

```
src/services/
├── JsonFileCrud/
│   ├── index.ts                    # Versión default (1.0.0)
│   └── config.json                 # (Opcional) Dependencias del service
├── JsonFileCrud/1.0.1-ts/
│   └── index.ts                    # Versión específica TypeScript
├── JsonFileCrud/2.0.0-ts/
│   └── index.ts                    # Versión major
└── JsonFileCrud/1.0.0-py/
    └── index.py                    # Versión en Python
```

### Especificadores de Versión

Soportados: `1.0.0` (exacta), `^1.0.0` (caret), `~1.2.3` (tilde), `>=1.0.0`, `>1.0.0`, `<=2.0.0`, `<2.0.0`, `*`/`latest`

### Declarar en config.json (Apps)

```json
{
	"failOnError": false,
	"services": [
		{
			"name": "JsonFileCrud",
			"version": "^1.0.0",
			"language": "typescript",
			"custom": {}
		}
	]
}
```

## Presets (módulos opcionales)

Los presets (`presets/<topic>/{apps,services,providers,utilities}`) son repos git independientes que el kernel monta como capas nativas. El flujo de instalación, creación y extracción está en [docs/multirepo.md](./docs/multirepo.md). Convenciones de código:

-   **tsconfig**: el tsconfig raíz del preset cubre SOLO `services/**/*.ts` (con `paths` relativos a `../../src/...`); cada app UI mantiene su propio tsconfig (jsx + aliases `@ui-library`). No usar `baseUrl` (eliminado en tsgo).
-   **Imports**: todo import que escape del preset usa aliases (`@common`, `@services`, `@providers`, `@utilities`, `@interfaces`, `@adc/utils`, `@kernel`). Imports internos relativos.
-   **Contratos con `src`**: las apps de `src` que consumen un servicio de preset opcional dependen de una interfaz en `@common/types` (ej. `IContentService`), nunca del tipo concreto del preset.
-   **Docs**: cada preset incluye `README.md` (propósito, módulos, deps externas, env vars críticas, `kernelMode` si aplica), `LICENSE.md`, y `CODE_OF_CONDUCT.md`/`SECURITY.md` apuntando al repo principal.
-   **Env vars**: cada servicio de preset con configuración externa documenta sus variables en un `.env.example` propio.

## Interoperabilidad Multi-Lenguaje

ADC Platform soporta módulos en múltiples lenguajes mediante IPC (named pipes):

**TypeScript ↔ Python:** Los módulos Python se comunican con TypeScript via named pipes nativos del SO.

**KernelLogger:** Los módulos Python tienen acceso al logger del kernel, manteniendo logs uniformes.

**Serialización:** Buffers y datos complejos se serializan automáticamente (base64 para JSON).

**Ejemplo:**

```json
{
	"utilities": [
		{
			"name": "json-file-adapter",
			"version": "1.0.0-py",
			"language": "python"
		}
	]
}
```

## Sistema UI Framework-Agnostic

Las UI libraries del proyecto están construidas con **Stencil** y generan Web Components nativos compatibles con cualquier framework (React, Vue, Angular, etc.). Hay una librería por namespace:

-   **`00-adc-ui-library`** (`src/apps/public/`): la librería principal de la plataforma, namespace `adc-platform`. Catálogo de componentes y utils en su `README.md`.
-   **`00-web-ui-library`** y **`00-web-ui-library-mobile`** (`src/apps/test/`): librerías de desarrollo para los namespaces `default` y `mobile`.

### Características

-   **Web Components nativos:** Los componentes se definen una vez y funcionan en cualquier framework
-   **Sin dependencias de framework:** Las apps que consumen los componentes no necesitan instalar React, Vue, etc.
-   **Auto-registro:** Los componentes se registran automáticamente al importar el loader
-   **TypeScript:** Tipado completo con definiciones generadas automáticamente

### Uso en Apps

```typescript
// En cualquier app React/Vue/etc:
import "@ui-library";

// Los eventos nativos del DOM funcionan directo (click, input, change, etc.):
<adc-button onClick={handleClick}>Click me</adc-button>

<adc-input
  inputId="name"
  value={value}
  onInput={(e) => setValue(e.target.value)}
/>

// Los componentes usan shadow: false, así que los eventos burbujean normalmente
```

### UIFederationService

Gestiona el build y servido de módulos UI:

-   Soporta Stencil, React, Vue, Vite y Astro
-   Build automático en desarrollo con watch mode
-   Module Federation con Rspack para apps React/Vue
-   Import maps dinámicos para resolución de módulos
-   Servido estático de componentes compilados
-   **Soporte Multi-UI con Namespaces:** Permite usar múltiples librerías UI sin colisiones

### UI Namespaces

El sistema soporta múltiples conjuntos de UI (librerías, layouts, apps) que no colisionan entre sí mediante namespaces. Cada namespace tiene su propio import map y rutas.

**Configuración:**

```json
{
	"uiModule": {
		"name": "layout",
		"uiNamespace": "mobile",
		"framework": "react",
		"devPort": 3014
	}
}
```

**Características:**

-   Los módulos del mismo namespace comparten la misma UI library
-   Import maps separados por namespace (`/:namespace/importmap.json`)
-   Rutas estáticas por namespace (`/:namespace/:moduleName/`)
-   El namespace `default` se usa cuando no se especifica

**Endpoints:**

-   `GET /api/ui/namespaces` - Lista namespaces disponibles
-   `GET /:namespace/importmap.json` - Import map del namespace
-   `GET /importmap.json` - Import map del namespace default

### Host-Based Routing (Producción)

En producción (`npm run start` o `npm run start:prodtests`), las apps UI se sirven mediante **virtual hosts** basados en dominios y subdominios, permitiendo que múltiples apps compartan el mismo puerto.

**Configuración en `config.json`:**

```json
{
	"uiModule": {
		"name": "layout",
		"hosting": {
			"hosts": [
				{
					"domain": "local.com",
					"subdomains": ["cloud", "users", "config", "*"]
				}
			]
		}
	}
}
```

**Formatos de configuración de hosting:**

```json
// Opción 1: Hosts con subdominios específicos
"hosting": {
  "hosts": [
    { "domain": "example.com", "subdomains": ["app", "admin", "*"] }
  ]
}

// Opción 2: Subdominios simples (usa dominio por defecto: local.com)
"hosting": {
  "subdomains": ["cloud", "users", "*"]
}

// Opción 3: Dominios completos
"hosting": {
  "domains": ["app.example.com", "admin.example.com"]
}
```

**Prioridad de hosts:**

-   Hosts específicos (`cloud.local.com`) tienen mayor prioridad
-   Comodines (`*.local.com`) tienen menor prioridad
-   Esto evita colisiones cuando múltiples apps usan comodines

**Puertos:**

-   `npm run start` → puerto 80 (producción real)
-   `npm run start:prodtests` → puerto 3000 (pruebas de producción)

**Modo Desarrollo vs Producción:**

| Modo              | Comando                   | Provider | Comportamiento                                      |
| ----------------- | ------------------------- | -------- | --------------------------------------------------- |
| Desarrollo        | `npm run dev`             | Express  | Dev servers en puertos separados (3001, 3003, etc.) |
| Producción (test) | `npm run start:prodtests` | Fastify  | Builds compiladas, host-based routing, puerto 3000  |
| Producción        | `npm run start`           | Fastify  | Builds compiladas, host-based routing, puerto 80    |

**Versiones Mobile:**

Las versiones mobile se distinguen usando prefijos o subdominios dedicados:

```json
// web-layout-mobile/config.json
{
	"uiModule": {
		"uiNamespace": "mobile",
		"hosting": {
			"hosts": [
				{ "domain": "local.com", "subdomains": ["m-cloud", "m-users", "m-*"] },
				{ "domain": "m.local.com", "subdomains": ["cloud", "users", "*"] }
			]
		}
	}
}
```

Esto permite acceder a la versión mobile via `m-cloud.local.com` o `cloud.m.local.com`.

### LangManagerService (i18n)

Servicio en modo kernel para internacionalización compartida entre apps UI. Cada app declara `"i18n": true` en su `uiModule` y provee traducciones en `i18n/{locale}.js|json` (un namespace por app, interpolación `{{param}}`, fallback automático de locale). Detalle de endpoints y uso client-side en `src/services/core/LangManagerService/README.md`.

### Service Worker Dinámico

UIFederationService genera automáticamente un service worker cuando `serviceWorker: true`:

```json
{
	"uiModule": {
		"name": "layout",
		"serviceWorker": true,
		"i18n": true
	}
}
```

**Características del SW generado:**

-   Cache stale-while-revalidate para `/api/i18n/*`
-   Cache-first para assets estáticos (`.js`, `.css`, imágenes)
-   Network-first para el resto
-   Preload de traducciones al registrar el SW

## Gestión de Dependencias con Workspaces

El proyecto utiliza [npm workspaces](https://docs.npmjs.com/cli/v7/using-npm/workspaces) para gestionar las dependencias de forma modular. Cada app, provider, utility y service es un "paquete" individual dentro del workspace, lo que permite un manejo de dependencias aislado y eficiente.

### Estructura

-   Cada módulo (ej. `src/apps/user-profile`) contiene su propio archivo `package.json`.
-   El `package.json` de la raíz del proyecto define la ubicación de estos paquetes a través de la directiva `workspaces`.

### Añadir Dependencias a un Módulo

Para añadir una dependencia de Node.js a un módulo específico, utiliza el flag `-w` (o `--workspace`) en el comando de instalación desde la raíz del proyecto. El nombre del workspace se define en el `package.json` del módulo.

**Ejemplo:**

```bash
# Instala la librería 'lodash' únicamente para el módulo 'user-profile'
npm install lodash -w @adc-platform/user-profile
```

### Beneficios

-   **Aislamiento:** Las dependencias de un módulo no afectan a otros.
-   **Mantenimiento Simplificado:** Si eliminas el directorio de un módulo y ejecutas `npm install` en la raíz, sus dependencias ya no se instalarán, manteniendo el `node_modules` general limpio.
-   **Instalación Única:** Un solo `npm install` en la raíz se encarga de instalar todas las dependencias de todos los módulos.

## Distribución de Responsabilidades

### Kernel

-   Carga recursiva de `providers/`, `utilities/`, `services/` (fallback global)
-   Ejecuta Apps encontradas
-   Registra módulos en el registry central
-   Soporta hot reloading en desarrollo

### BaseApp

-   Responsable de cargar sus propios módulos desde `config.json`
-   Obtiene módulos del kernel después de cargarlos
-   Ejecuta lógica de negocio en `run()`
-   NO declara dependencias estáticas

### ModuleLoader

-   Resuelve versiones según especificadores semver
-   Selecciona loader por lenguaje
-   Carga dinámicamente módulos versionados
-   Pasa configuración al módulo

## Optimizaciones de Memoria y Rendimiento

-   Cada app carga solo los módulos que declara en `config.json`
-   El Kernel mantiene un fallback global para módulos sin versionar
-   ExecutionManagerService distribuye carga pesada a workers
-   Menor impacto en memoria en ejecuciones con múltiples apps
-   Preparado para clusterización futura (nodos remotos en lugar de workers)
