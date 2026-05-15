
# ADC Platform [![Quality Gate Status](https://sonarcloud.io/api/project_badges/measure?project=abbytec_ADC-platform&metric=alert_status)](https://sonarcloud.io/summary/new_code?id=abbytec_ADC-platform) [![CodeQL](https://github.com/abbytec/ADC-platform/actions/workflows/github-code-scanning/codeql/badge.svg)](https://github.com/abbytec/ADC-platform/actions/workflows/github-code-scanning/codeql)

ADC Platform es un kernel de software modular y dinámico construido sobre Node.js y TypeScript. Su arquitectura está diseñada para permitir la creación de aplicaciones complejas y escalables a través de la composición de módulos independientes: **Providers**, **Utilities**, **Services** y **Apps**.

El objetivo principal del proyecto es ofrecer una base sólida y flexible que desacopla la lógica de negocio de las capas de infraestructura, permitiendo un desarrollo ágil y un alto grado de reutilización de código. La plataforma está pensada para evolucionar y soportar funcionalidades avanzadas como:

-   **Pipelines automáticos:** Creación de flujos de trabajo que se actualizan y despliegan de forma automática.
-   **Clusterización:** Orquestación de múltiples instancias de la plataforma para lograr alta disponibilidad y balanceo de carga.
-   **Aplicaciones Cloud:** Proveer caracteristicas típicas de servicios en la nube.
-   **Sistemas multi-tenant:** Una sola instancia de la plataforma sirviendo a múltiples clientes con configuraciones y datos aislados.

## Características Principales

-   **Carga Dinámica de Módulos:** El kernel carga y enlaza módulos en tiempo de ejecución desde el sistema de archivos, incluyendo búsqueda recursiva en subdirectorios.
-   **Gestión de Dependencias Aislada:** Gracias a los [npm workspaces](https://docs.npmjs.com/cli/v7/using-npm/workspaces), cada módulo gestiona sus propias dependencias sin interferir con el resto del sistema.
-   **Hot Reloading:** En modo de desarrollo (`npm run dev`), los cambios en el código fuente o en los archivos de configuración de las apps recargan automáticamente los componentes afectados sin necesidad de reiniciar.
-   **Interoperabilidad Multi-lenguaje:** Soporte para módulos en TypeScript y Python con comunicación via IPC (named pipes).
-   **Ejecución Distribuida:** Sistema de workers gestionado automáticamente para distribuir carga pesada según uso de CPU y memoria.
-   **Instancias Múltiples de Apps:** Una misma base de código puede ejecutarse en múltiples instancias con diferentes configuraciones.
-   **Servicios en Modo Kernel:** Servicios globales que se cargan antes que las apps y están disponibles para toda la plataforma.
-   **Gestión de Identidades:** Sistema integral de usuarios, roles y grupos con persistencia en MongoDB.
-   **Provisioning Automático:** Auto-ejecución de `docker-compose.yml` en apps que lo requieran.
-   **Preparado para Clusterización:** Arquitectura diseñada para soportar nodos remotos en el futuro.

## Quick Start

### Desarrollo

```bash
npm install
npm run dev          # Inicia en modo desarrollo con HMR
```

### Producción

```bash
npm run start   # Ejecuta sin apps de test
```

## Servicios en Modo Kernel

Los servicios en modo kernel se cargan automáticamente antes que las apps:

-   **ExecutionManagerService:** Gestión distribuida de workers y balanceo de carga
-   **IdentityManagerService:** Gestión centralizada de usuarios, roles y grupos con persistencia en MongoDB

## Gestión de Identidades

El `IdentityManagerService` proporciona:

-   **8 Roles Predefinidos:** SYSTEM, Admin, Network Manager, Security Manager, Data Manager, App Manager, Config Manager, User
-   **Usuario SYSTEM:** Creado automáticamente con credenciales aleatorias en cada arranque
-   **Roles Personalizados:** Posibilidad de crear nuevos roles con permisos granulares
-   **Grupos:** Agrupación de usuarios con asignación automática de roles
-   **Persistencia:** Usa MongoDB cuando está disponible, funciona con datos en memoria como fallback
-   **Seguridad:** Contraseñas hasheadas con PBKDF2 (100,000 iteraciones) y salt de 16 bytes

### Ejemplo: Usar IdentityManager en una App

```typescript
// Obtener el servicio
const identityService = this.kernel.getService<any>("IdentityManagerService");
const identity = await identityService.getInstance();

// Crear usuario
const user = await identity.createUser("john", "password123", [roleId]);

// Autenticar
const authenticated = await identity.authenticate("john", "password123");

// Crear grupo
const group = await identity.createGroup("Team A", "Mi equipo", [roleId]);

// Agregar usuario a grupo
await identity.addUserToGroup(user.id, group.id);

// Estadísticas
const stats = await identity.getStats();
console.log(`${stats.totalUsers} usuarios, ${stats.totalRoles} roles`);
```

## Provisioning Automático con Docker Compose

Si una app contiene un archivo `docker-compose.yml`, el kernel lo ejecutará automáticamente antes de iniciar la app:

```yaml
# src/apps/test/user-profile/docker-compose.yml
version: "3.8"
services:
    mongo:
        image: mongo:latest
        ports:
            - "27017:27017"
        environment:
            MONGO_INITDB_ROOT_USERNAME: admin
            MONGO_INITDB_ROOT_PASSWORD: password
```

Luego en la configuración de la app (`default.json`), referencia el provider:

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

## Estructura del Proyecto

```
src/
├── apps/                    # Aplicaciones
│   ├── core/               # Apps de núcleo
│   └── test/               # Apps de prueba
├── providers/              # Proveedores (persistencia, base de datos, etc)
│   ├── files/file-storage/
│   └── object/mongo/       # Provider de MongoDB
├── services/               # Servicios de la plataforma
│   ├── core/
│   │   ├── ExecutionManagerService/
│   │   └── IdentityManagerService/
│   └── data/json-file-crud/
└── utilities/              # Utilidades reutilizables
```

## Configuración de Módulos

Cada módulo usa `package.json` para gestionar dependencias y un archivo de configuración según el tipo:

-   **Providers:** `config.json` (opcional)
-   **Services:** `config.json` (para definir providers/utilities internas)
-   **Apps:** `default.json` + `configs/*.json` (múltiples instancias)

Para una descripción técnica detallada, consulta [ARCHITECTURE.md](./ARCHITECTURE.md).
