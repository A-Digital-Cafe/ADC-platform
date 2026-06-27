# Documentación de ADC Platform

Índice maestro. Cargá **solo** el doc relevante a tu tarea (cada hoja vive en un único índice; este
README enruta por categoría, no re-lista cada archivo).

| Necesito… | Empezar en |
| --------- | ---------- |
| Entender cómo funciona la plataforma | [architecture/README.md](architecture/README.md) |
| Crear/editar un módulo (app/service/provider/utility) | [structure/README.md](structure/README.md) |
| Crear, instalar o extraer un preset (repos git) | [multirepo.md](multirepo.md) |
| Guías operativas (Discord OAuth, email/DNS, puertos) | [guides/](guides/) |

## Categorías

- **[architecture/](architecture/README.md)** — Modelo de capas, flujo de carga y temas profundos:
  [module-system](architecture/module-system.md) (loaders, versionado, multi-lenguaje, workspaces),
  [app-runtime](architecture/app-runtime.md) (instancias, hot reload, docker),
  [ui-federation](architecture/ui-federation.md) (Web Components, Module Federation, namespaces, i18n).
- **[structure/](structure/README.md)** — Plantillas + checklists para crear/editar módulos
  (models, daos, endpoints, service-shell, frontend, enterprise-apps).
- **[multirepo.md](multirepo.md)** — Presets: instalación, creación, extracción y convenciones.
- **[guides/](guides/)** — Guías operativas puntuales:
  [discord-oauth](guides/discord-oauth.md), [email-dns-setup](guides/email-dns-setup.md),
  [ports](guides/ports.csv), [security-ci](guides/security-ci.md).
