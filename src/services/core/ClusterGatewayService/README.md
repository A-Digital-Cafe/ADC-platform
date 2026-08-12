# ClusterGatewayService

Reenvía a los vecinos lo que este nodo no sabe servir. `kernelMode: 92`, inactivo salvo
`ADC_CLUSTER_GATEWAY=true`: con un solo nodo arranca y no registra nada.

- **Vhost ajeno**: si ni un vhost local ni una ruta global atienden la request, va al vecino `ready`
  con `advertise`, prefiriendo el del mismo `ADC_NODE_SITE` (turnos entre ésos). Un `Host` que es IP
  o `localhost` nombra a este proceso: no se reenvía, igual que `/healthz`.
- **Afinidad**: `registerAffinityResolver(nombre, req => "tunnel:device:<id>")` + `whereIs`. Se
  consulta antes del ruteo local, porque la ruta existe acá pero la conexión viva no. Hoy lo produce
  el túnel de Drive (reclama y desvía); el SSE de notificaciones sólo reclama —el bus ya entrega en
  cualquier nodo y desviar un stream establecido lo cortaría—.
- **Afinidad por build** (cookie de sesión `adc_build`, sólo si hay vecinos): el documento sale
  siempre de este nodo y reescribe la cookie; sus sub-recursos siguen al build con el que se cargó,
  para que un chunk no caiga en un nodo que no lo tiene. La API queda afuera. ⚠️ **Declarar la
  cookie en la política de cookies antes de encender el segundo nodo** (documento legal versionado:
  30 días de preaviso).
- **Anti-bucle**: sella `X-ADC-Forwarded-By`; lo marcado se sirve local o da 502, nunca rebota.
- ⚠️ **Las IPs de los nodos van en el `TRUSTED_PROXIES` de cada nodo.** Si no, `request.ip` es la
  del vecino: el rate limit mete a todos en un bucket y los bans por IP banean al nodo.
- La decisión por vhost no toca Redis por **latencia** (corre en cada request, también en las que se
  sirven acá), no porque esperar rompa el cuerpo: eso era un diagnóstico equivocado —medido, 256 MB
  llegan enteros tras tres round trips previos al `hijack()`— y el camino con afinidad ya espera.
- ⚠️ Lo que sí deja la subida en **cero bytes** es que el handler vuelva sin `reply.hijack()` ni
  responder: ahí el server descarta el cuerpo y contesta 200 solo (medido con 256 MB).
