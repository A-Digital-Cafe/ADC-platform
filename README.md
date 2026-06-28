# ADC Platform [![Quality Gate Status](https://sonarcloud.io/api/project_badges/measure?project=A-Digital-Cafe_ADC-platform&metric=alert_status)](https://sonarcloud.io/summary/new_code?id=A-Digital-Cafe_ADC-platform) [![CodeQL](https://github.com/A-Digital-Cafe/ADC-platform/actions/workflows/github-code-scanning/codeql/badge.svg)](https://github.com/A-Digital-Cafe/ADC-platform/actions/workflows/github-code-scanning/codeql) [![Security](https://github.com/A-Digital-Cafe/ADC-platform/actions/workflows/security.yml/badge.svg)](https://github.com/A-Digital-Cafe/ADC-platform/actions/workflows/security.yml)

ADC Platform es un kernel de software modular y dinámico construido sobre Node.js y TypeScript. Su arquitectura está diseñada para permitir la creación de aplicaciones complejas y escalables a través de la composición de módulos independientes: **Providers**, **Utilities**, **Services** y **Apps**.

El objetivo principal del proyecto es ofrecer una base sólida y flexible que desacopla la lógica de negocio de las capas de infraestructura, permitiendo un desarrollo ágil y un alto grado de reutilización de código. La plataforma está pensada para evolucionar y soportar funcionalidades avanzadas como:

- **Pipelines automáticos:** Creación de flujos de trabajo que se actualizan y despliegan de forma automática.
- **Clusterización:** Orquestación de múltiples instancias de la plataforma para lograr alta disponibilidad y balanceo de carga.
- **Aplicaciones Cloud:** Proveer caracteristicas típicas de servicios en la nube.
- **Sistemas multi-tenant:** Una sola instancia de la plataforma sirviendo a múltiples clientes con configuraciones y datos aislados.

## Características Principales

- **Carga Dinámica de Módulos:** El kernel carga y enlaza módulos en tiempo de ejecución desde el sistema de archivos, incluyendo búsqueda recursiva en subdirectorios.
- **Gestión de Dependencias Aislada:** Gracias a los [npm workspaces](https://docs.npmjs.com/cli/v7/using-npm/workspaces), cada módulo gestiona sus propias dependencias sin interferir con el resto del sistema.
- **Hot Reloading:** En modo de desarrollo (`npm run dev`), los cambios en el código fuente o en los archivos de configuración de las apps recargan automáticamente los componentes afectados sin necesidad de reiniciar.
- **Interoperabilidad Multi-lenguaje:** Soporte para módulos en TypeScript y Python con comunicación via IPC (named pipes).
- **Ejecución Distribuida:** Sistema de workers gestionado automáticamente para distribuir carga pesada según uso de CPU y memoria.
- **Instancias Múltiples de Apps:** Una misma base de código puede ejecutarse en múltiples instancias con diferentes configuraciones.
- **Servicios en Modo Kernel:** Servicios globales que se cargan antes que las apps y están disponibles para toda la plataforma.
- **Gestión de Identidades:** Sistema integral de usuarios, roles y grupos con persistencia en MongoDB.
- **Provisioning Automático:** Auto-ejecución de `docker-compose.yml` en apps que lo requieran.
- **Preparado para Clusterización:** Arquitectura diseñada para soportar nodos remotos en el futuro.

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

- **ExecutionManagerService:** Gestión distribuida de workers y balanceo de carga
- **IdentityManagerService:** Gestión centralizada de usuarios, roles y grupos con persistencia en MongoDB

## Gestión de Identidades

El `IdentityManagerService` (servicio en modo kernel) gestiona usuarios, roles, grupos y organizaciones con persistencia en MongoDB, hashing PBKDF2 y permisos granulares por recurso/acción/alcance. Detalle en [docs/architecture/README.md](./docs/architecture/README.md) y en `src/services/core/IdentityManagerService/README.md`.

## Provisioning Automático con Docker Compose

Si una app contiene un archivo `docker-compose.yml`, el kernel lo ejecutará automáticamente antes de iniciar la app. Ver detalles y ejemplos en [docs/architecture/app-runtime.md](./docs/architecture/app-runtime.md).

## Estructura del Proyecto

```
src/
├── apps/                    # Aplicaciones
│   ├── public/             # Apps públicas (namespace adc-platform)
│   └── test/               # Apps de desarrollo (namespace default)
├── providers/              # Proveedores I/O (http/, object/, queue/, files/, security/)
├── services/               # Servicios de la plataforma
│   ├── core/               # IdentityManager, UIFederation, EndpointManager, etc.
│   ├── data/               # Servicios de datos
│   └── security/           # SessionManager, Moderation, etc.
├── utilities/              # Utilidades reutilizables
├── common/                 # Tipos y utilidades compartidas (@common)
└── utils/                  # Helpers internos del kernel
presets/                    # Módulos opcionales en repos git propios (docs/multirepo.md)
```

Para crear módulos nuevos de forma estandarizada, ver las plantillas en [docs/structure/README.md](./docs/structure/README.md).

## Configuración de Módulos

Cada módulo usa `package.json` para gestionar dependencias y un archivo de configuración según el tipo:

- **Providers:** `config.json` (opcional)
- **Services:** `config.json` (para definir providers/utilities internas)
- **Apps:** `default.json` + `configs/*.json` (múltiples instancias)

Para una descripción técnica detallada, consulta [docs/architecture/](./docs/architecture/README.md) (índice general en [docs/README.md](./docs/README.md)).

## License

The source code is licensed under the ISC License.

Project name, logos, and branding assets are governed by
TRADEMARK_POLICY.md and are not licensed under the ISC License.
