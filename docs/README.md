# Documentación de ADC Platform

Índice maestro. Cargá **solo** el doc relevante a tu tarea (cada hoja vive en un único índice; este
README enruta por categoría, no re-lista cada archivo).

| Necesito… | Empezar en |
| --------- | ---------- |
| Entender cómo funciona la plataforma | [architecture/README.md](architecture/README.md) |
| Crear/editar un módulo (app/service/provider/utility) | [structure/README.md](structure/README.md) |
| Acceder a otro módulo o a una superficie privilegiada del kernel | [structure/kernel-access.md](structure/kernel-access.md) |
| Crear, instalar o extraer un preset (repos git) | [multirepo.md](multirepo.md) |
| Guías operativas (Discord OAuth, email/DNS, puertos) | [guides/](guides/) |

## Categorías

- **[architecture/](architecture/README.md)** — Modelo de capas, flujo de carga y temas profundos:
  [module-system](architecture/module-system.md) (loaders, versionado, multi-lenguaje, workspaces),
  [app-runtime](architecture/app-runtime.md) (instancias, hot reload, docker),
  [ui-federation](architecture/ui-federation.md) (Web Components, Module Federation, namespaces, i18n),
  [boot-performance](architecture/boot-performance.md) (concurrencia del arranque, readiness, caché de bundler, flags).
- **[structure/](structure/README.md)** — Plantillas + checklists para crear/editar módulos
  (models, daos, endpoints, service-shell, frontend, enterprise-apps) y
  [kernel-access](structure/kernel-access.md), que es **la autoridad** sobre qué puede pedirle
  un módulo al kernel y por qué vía (`getMyService`/`getMyProvider` vs. casos privilegiados).
- **[multirepo.md](multirepo.md)** — Presets: instalación, creación, extracción y convenciones.
- **[guides/](guides/)** — Guías operativas puntuales:
  [breach-response](guides/breach-response.md) (incidentes que afectan datos personales),
  [desktop-clients](guides/desktop-clients.md) (clientes que se publican en npm),
  [discord-oauth](guides/discord-oauth.md), [email-dns-setup](guides/email-dns-setup.md),
  [github-deploy-auth](guides/github-deploy-auth.md) (device flow para deploys y clones de presets),
  [mongo-sharding](guides/mongo-sharding.md) (convertir el replica set en clúster sharded, y la
  verificación de integridad de la infraestructura),
  [name-policy](guides/name-policy.md) (alias de correo y usernames prohibidos),
  [network-vpn](guides/network-vpn.md) (red privada entre nodos y alta de una máquina nueva),
  [ports](guides/ports.csv), [security-ci](guides/security-ci.md),
  [tls-edge](guides/tls-edge.md) (dónde se termina el TLS y por qué el puerto del kernel va plano
  en la red privada),
  [storage-replication](guides/storage-replication.md) (cambiar cuántas copias guarda el
  almacenamiento de objetos, y cuánto entra con cada factor).

> La operación fiscal (monotributo/ARCA, facturación electrónica) y el modelo de precios
> se documentan aparte, fuera de este repositorio: describen el flujo contable de quien
> opera la plataforma, no cómo funciona la plataforma.
