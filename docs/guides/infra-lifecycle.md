# Ciclo de vida de la infraestructura (y cómo volver si te quedás afuera)

Los motores (Mongo, Redis, Garage, RabbitMQ, Haraka, NetBird) son composes de
`src/common/docker/<dir>`, uno por stack, con alias corto (`adc-redis-core` → `redis`). El kernel los
levanta **al arrancar** (`DockerManager.loadCommonDockerCompose`) y los baja al cerrarse; los módulos
no corren en contenedores, así que esto es toda la infra externa que administra la plataforma.

Tres perillas, en dos pantallas distintas, con consecuencias muy distintas:

| Perilla | Dónde | Qué decide | ¿Lo repone un reinicio? |
| ------- | ----- | ---------- | ----------------------- |
| **Motores que levanta** (`infra`) | Red → Nodos → Estado | Qué composes arranca ese nodo | **No.** El arranque levanta sólo lo que está en la lista |
| **Al cerrar el kernel** (`infraShutdown`) | Módulos → Recursos → Ciclo de vida | Si el cierre baja los stacks (`auto`) o los deja corriendo (`manual`) | Sí: el arranque los levanta igual |
| **Levantar / Detener** | Módulos → Recursos → Ciclo de vida | Enciende o apaga un stack ahora mismo | Sí, en el próximo arranque |

Las tres viven en `env/node-state.json`, no en el entorno: la topología de una máquina tiene que
sobrevivir a un reinicio y a que alguien copie el `.env` de otra.

## Motores críticos: el error que se cierra sobre sí mismo

`mongo` y `redis` están marcados **críticos** en
[`src/common/utils/infra-composes.ts`](../../src/common/utils/infra-composes.ts): Mongo guarda
identidades y roles, Redis guarda sesiones, topes de rate y leases. Sin ellos no hay con qué validar
un login, así que apagarlos **se lleva puesto el panel desde el que se volverían a encender**. Un
Garage caído rompe los archivos y se arregla desde la UI; un Redis caído se arregla en una consola.

Por eso las dos operaciones que los sacan de circulación piden confirmación explícita, y la piden
también por API (el 409 es del servicio, no del formulario):

- **Detener** un stack crítico → `409 CRITICAL_STACK`, hay que reenviar con `force: true`. Antes de
  bajarlo el servicio **rearma la reposición**: vuelve `infraShutdown` a `auto` y repone el alias en
  los motores del nodo si una selección guardada lo excluía. Así reiniciar el kernel alcanza.
- **Destildarlo** en "Motores que levanta" → `409 INFRA_CRITICAL_DROPPED`, hay que reenviar con
  `confirmCritical: true`. Acá no hay nada que rearmar: es una decisión sobre el próximo arranque, y
  es legítima si el nodo usa el Mongo y el Redis de otra máquina (`MONGO_URI`, `REDIS_HOST`).

Las dos quedan auditadas (`infra-stop` con `detail.armed`, `node-state` con `detail.droppedCritical`).

## Volver a levantarlo a mano

Desde una consola en la máquina, sin panel y sin kernel:

```bash
bun run infra ls              # qué stacks hay y cuáles están corriendo
bun run infra up redis        # o `up mongo redis`, o el nombre del directorio
bun run infra down redis      # baja con 60 s de gracia, como el cierre ordenado
```

`scripts/infra.ts` hace lo mismo que el kernel al arrancar: carga `env/*.env` (sin eso
`REDIS_PASSWORD` queda vacía y el motor arranca sin auth), crea la red compartida `adc-core-net` y
corre `docker compose` en el directorio del stack — el mismo proyecto, así que el volumen es el mismo.

El equivalente crudo, si no se puede correr bun:

```bash
docker network create adc-core-net   # si no existe
set -a; . env/secrets.env; . env/host.env; set +a
docker compose -f src/common/docker/adc-redis-core/docker-compose.yml up -d
```
