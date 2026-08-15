# Convertir el replica set en un clúster sharded

Lo hace el panel **Admin - Network → Nodos → Topología de Mongo**, con una máquina de estados
persistida que se retoma después de un corte. Esta guía es lo que el panel no puede decir en un
tooltip: **por qué hay dos etapas, qué pasos necesitan a una persona, y las tres trampas que hacen
fallar la conversión con mensajes que apuntan a otro lado**.

> **Antes de nada: ¿hace falta?** Shardear reparte una colección grande entre varias máquinas. **No
> agrega redundancia** —eso lo dan los miembros del replica set— y no acelera nada por sí solo. Un
> clúster de un shard es un estado final perfectamente válido, y es donde termina la etapa 1.

## Las dos etapas, y por qué están separadas

| | Qué hace | ¿Mueve datos? | ¿Se puede deshacer? |
| --- | --- | --- | --- |
| **1. Plano de control** | Levanta los config servers y el router, agrega el replica set actual como shard y reapunta la plataforma | **No, ni un byte** | Sí: devolver `MONGO_HOST` a su valor anterior y bajar el plano de control |
| **2. Colecciones** | `shardCollection` sobre las colecciones elegidas | Sí | **No.** No existe operación inversa, y la clave de shard tampoco se cambia después |

Están separadas porque juntarlas haría que una decisión reversible arrastrara a una que no lo es. La
etapa 2 exige confirmación aparte y ventana de mantenimiento declarada.

## Los pasos que necesitan a una persona

La máquina avanza sola y se detiene en `te espera` cuando llega a algo que no puede hacer por sí
misma. Son tres, y todos por el mismo motivo: **viven en el `env/` de cada máquina**, y reescribir
entorno en todos los nodos desde un panel sería la superficie más peligrosa que tendría.

1. **Levantar el plano de control.** El panel suma `mongo-shard` a los motores del nodo; hay que
   reiniciarlo (Nodos → Estado → Aplicar). Sólo el **primario**: los config servers guardan el
   catálogo de qué dato vive en qué shard, y dos clústers de config servers son dos mapas distintos
   del mismo territorio.
2. **Declarar el replica set como miembro de un clúster.** `MONGO_SHARDSVR=--shardsvr` en
   `env/storage.env`, **en cada nodo que aloje un miembro**, y reiniciar.
3. **Reapuntar la plataforma al router.** `MONGO_HOST=127.0.0.1:27018` y
   `MONGO_OPTIONS=authSource=admin` en `env/storage.env` de **cada** nodo, y reiniciar. Mientras un
   nodo siga apuntando al replica set, sus escrituras se saltean el router.

Después de cada reinicio, «Retomar» sigue desde donde quedó. Cada paso comprueba su propio efecto
antes de actuar, así que retomar de más nunca ejecuta de más.

## Las tres trampas

Las tres se descubrieron en el ensayo y las tres fallan con mensajes que no mencionan la causa.

**1. Sin `--shardsvr`, `addShard` falla hablando de preferencias de lectura.** El error es
`Could not find host matching read preference { mode: "primary" } for set rs0`, que manda a buscar
un problema de red o de credenciales que no existe. Poner el flag **no corta el servicio**: un
`shardsvr` que todavía no pertenece a ningún clúster sigue aceptando lecturas y escrituras directas,
así que la plataforma funciona durante toda esa ventana. Verificado.

**2. El config server también tiene que alcanzar al shard.** `sh.addShard` se ejecuta contra el
router, pero el router lo reenvía al **config server**, que es quien valida el replica set y guarda
el catálogo. Si el config server no llega al shard, el error es el mismo de arriba — y el
contenedor que no llega ni siquiera aparece en el comando. Por eso el compose lo pone en las dos
redes.

**3. El keyfile tiene que ser el mismo, y el usuario raíz NO se hereda.** La autenticación interna
de Mongo exige bytes idénticos en todo el clúster: el compose monta el volumen del keyfile del
shard, no genera uno propio. Y los usuarios de un clúster viven en los **config servers**, que
empiezan vacíos: el usuario raíz se crea ahí aparte, aprovechando la excepción de localhost desde un
contenedor que comparte el namespace de red del config server. Esa excepción alcanza para crear el
primer usuario y **para nada más**, ni siquiera para contar los que hay.

## Lo que la conversión NO hace

- **No agrega un segundo shard.** Sumar hierro es otra operación, con su propio movimiento de datos.
- **No corre `movePrimary`.** Con un solo shard no hay a dónde mover: cada base ya tiene su primario
  ahí. La pregunta aparece recién con un segundo shard.
- **No quita un shard ni deshace la etapa 2.** Son las operaciones que borran o mueven datos sin
  vuelta atrás, y no se disparan desde una pantalla.

## Verificación de integridad

Aparte de la conversión, el panel corre un barrido de fondo (**Integridad de la infraestructura**)
que contesta lo que ningún healthcheck contesta: particiones del almacenamiento sin todas sus
copias, ventana del oplog demasiado corta para que una réplica caída vuelva a alcanzar al primario,
último volcado de Redis fallado, disco por llenarse y `validate` por colección de Mongo (en
background: la variante en primer plano toma un lock exclusivo).

**No repara nada**: registra, avisa al equipo por el canal de seguridad **en el flanco** —una vez,
no en cada pasada— y deja el rastro en la auditoría. El número a mirar es `oldestCheckedAt`: si un
chequeo lleva semanas sin recalcularse, los verdes de la lista no son de ahora.

Un chequeo que no se puede correr se informa como **aviso**, no como fallo: un token vencido y un
dato perdido no pueden disparar la misma alarma. Y los «todavía no» —una colección recién creada
que aún no tiene checkpoint— no se registran: quedan en la cola para el próximo lote, porque un
tablero que avisa de lo que no pasa nada es un tablero que se deja de mirar.
