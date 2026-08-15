# `env/` — configuración de la raíz, partida por concern

Un archivo por tema. Sólo se versionan los `*.env.example`; los `.env` reales están gitignoreados.

El reparto lo decide **`src/common/utils/env-manifest.ts`**, que es la única fuente: de ahí lo leen
el cargador, el migrador, el configurador y el runbook de alta de nodo.

| Archivo | Qué va | ¿Se copia a otro nodo? |
| ------- | ------ | ---------------------- |
| `host.env` | Identidad y forma de **este** nodo: `ADC_NODE_*`, `ADC_INFRA_COMPOSE`, puerto, TLS, capacidad de Garage, miembro del replica set, alta por token | **Nunca.** Es lo que hace distinto a cada nodo |
| `network.env` | Cómo se expone y en quién confía: proxies, CORS, CSP, HSTS, HTTP/2 | Sí, igual en todos |
| `storage.env` | Dónde viven los datos: Mongo, Redis, Rabbit, S3/Garage. Agrupado por motor, no por «endpoint vs ajuste» | Sí |
| `mail.env` | Dominio, DKIM, relay y retenciones del correo | Sí |
| `build.env` | Qué compila y cuánto loguea este proceso. Es de la máquina, no del clúster | Sí |
| `optionals.env` | Integraciones y frenos que casi nunca se tocan: cierre ordenado, base legacy del panel de red | Sí |
| `secrets.env` | Los que tienen que ser **idénticos** en todos los nodos. `0600` | **Idénticos**, y a mano |
| `identity.env` | Los 17 `ADC_PUBLIC_*`: identidad legal del operador, horneada en los bundles del navegador | Sí |

> `host.env` y `secrets.env` se escriben con permisos `0600`.

## Lo que ya NO vive acá

Retenciones, ventanas de los barridos, límites de cuerpo y de caudal, URLs de confirmación y la
configuración de despliegue desde GitHub se mudaron a **`platform_settings`**, una colección de
Mongo que lee `PlatformSettingsService` al arrancar (`kernelMode 5`). El motivo es que no describen
a una máquina sino al clúster: tenerlas en un archivo por nodo sólo garantizaba que alguna quedara
distinta sin que nadie se enterara.

La lista completa, con su valor por defecto y para qué sirve cada una, está en
`src/services/core/PlatformSettingsService/defaults.json`. En el manifiesto quedan marcadas con
`source: "platform-settings"`: siguen documentadas, pero **no van en ningún archivo de acá**.

Si una de ellas quedó definida en el entorno, gana la base y el arranque lo dice por log — editar el
archivo no tendría efecto y eso no puede ser silencioso. La excepción es la primera vez: al sembrar,
un valor que esté en el entorno se toma como el inicial, así que mudar una variable no pierde lo que
estaba configurado.

## Orden de carga

`identity → build → storage → mail → optionals → network → secrets → host`, **el último gana**.
Después van los overlays por entorno (`env/build.development.env`) y, por compatibilidad, un `.env`
de la raíz si todavía existe. Lo exportado de verdad en el shell (`FOO=1 bun run dev`, systemd,
docker) manda sobre todo.

## Migrar desde el `.env` monolítico

```bash
bun run env:split -- --dry-run   # muestra a qué archivo va cada variable, sin escribir
bun run env:split                # parte el .env / .env.example en esta carpeta
bun run env:split -- --prune     # cuando esté verificado: .env → .env.pre-split.bak
```

Es **idempotente** y arrastra los comentarios de cada variable. Mientras el `.env` de la raíz siga
existiendo le gana a esta carpeta, y el arranque lo avisa (en producción directamente aborta): un
split a medias, con la mitad de la configuración de cada origen, es peor que no haberlo hecho.

Una variable que el `.env` real no tenía queda **comentada**, no activa. La migración deja el
despliegue exactamente como estaba; activar un valor de ejemplo sería configurar algo que nadie
configuró.

## Un nodo nuevo no escribe casi nada de esto

Con el alta por token, la máquina nueva arranca con **cinco variables en `host.env`**
(`ADC_NODE_ID`, `ADC_NODE_SITE`, `ADC_NODE_ROLE` y las dos del alta) y recibe el resto del clúster,
que se lo escribe acá con los mismos permisos que pondría el migrador. Lo que ya tenga valor local
gana: el alta trae lo que falta, no pisa decisiones tomadas en esa máquina.

El grupo `host` **nunca** viaja: es lo que hace distinto a cada nodo. Detalle en
[docs/guides/network-vpn.md](../docs/guides/network-vpn.md).

## Agregar una variable

1. Entrada en `src/common/utils/env-manifest.ts` (grupo, y `shared: true` + `why` si tiene que ser
   idéntica entre nodos).
2. La variable, con su comentario, en el `*.env.example` de su grupo.

Si se lee por un camino que no es `process.env.X` —el mapa `PUBLIC_ENV_VARS`, el helper `env()` de
`cluster-env.ts`, o sólo un `docker-compose.yml`— hay que marcarla `indirect` en el manifiesto, o la
auditoría la va a reportar como huérfana y ofrecer retirarla.

## Auditar y limpiar

El configurador audita en **tres direcciones** (antes sólo en una):

| Dirección | Qué encuentra |
| --------- | ------------- |
| Declarada sin valor | variables sin valor actual, default ni ejemplo |
| Usada sin declarar | referenciadas en el código o en un compose y ausentes del manifiesto |
| **Escrita sin usar** | presentes en un `env/*.env` que ya no consume nadie |

La tercera es nueva y es la que faltaba: una variable que dejaba de usarse se quedaba en el archivo
para siempre. Se descubre cruzando cinco fuentes —`${VAR}` de configs y composes, `process.env.X` del
código, el mapa `PUBLIC_ENV_VARS`, el helper `env()` de `cluster-env.ts` y los `.example`—, y basta
que aparezca en cualquiera para NO considerarla obsoleta: el resultado alimenta un borrado, así que
el error caro es el falso positivo.

Retirar **comenta, no borra**: la línea queda con la fecha y el motivo, y hay respaldo en
`env/.backup/`. Eliminarlas de verdad es un segundo paso, pasados 30 días.

> Las variables **de módulo** no van acá: cada módulo tiene su propio `.env` junto a su
> `config.json`, que `ModuleLoader` lee aparte y con prioridad sobre `process.env`.
