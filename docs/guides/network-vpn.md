# Red privada y alta de nodos

Cómo sumar una máquina al clúster sin publicar un solo puerto de infraestructura.

El problema que resuelve: hoy un nodo remoto exige exponer a internet el RPC del almacenamiento
(3901) y el replica set de Mongo (27017), o directamente no puede existir. Con una red overlay,
todo eso vuelve a ser tráfico de una red local que, físicamente, no lo es.

El alta tiene **dos mitades independientes**, y en este orden:

1. **La máquina entra en la red privada** — `scripts/setup-node-vpn.mjs`, a mano, como root.
2. **El kernel de esa máquina se configura solo** — canjea un token contra el clúster, por la red
   que acaba de conseguir en el paso 1.

Son dos porque la segunda viaja por la primera: el canje sólo se acepta desde dentro de la overlay.

---

## 1. Levantar el plano de control (una vez, en el nodo primario)

> **La identidad la pone la plataforma.** NetBird self-hosted no tiene usuarios propios y delega en
> un OIDC externo; ese OIDC es la propia plataforma, así que no hay un proveedor de identidad más
> que operar ni cuentas que mantener en dos lados. Quien entra a la consola de la red privada entra
> con su usuario de siempre. Detalle en «La identidad», más abajo.

El stack de la overlay **no arranca solo**: es el único de `src/common/docker/` que hay que nombrar
en `ADC_INFRA_COMPOSE`, y sólo corre en el primario (forzado en `cluster-env.ts`, no en el compose).

### Qué son los cinco contenedores

El servidor self-hosted no es una sola pieza, y confundirlo con el agente cliente
(`netbirdio/netbird`) es un error caro: esa imagen corre `netbird up` y no sirve de plano de control.

| Contenedor | Qué hace | Dónde escucha |
| ---------- | -------- | ------------- |
| `management` | Peers, claves de alta, políticas, rutas. Expone el API REST | público, `NETBIRD_PUBLIC_PORT` |
| `signal` | Reenvía la señalización con que dos peers se ponen de acuerdo | público, `NETBIRD_SIGNAL_PORT` |
| `relay` | Camino de último recurso cuando el NAT no deja hole punching | público, `NETBIRD_RELAY_PORT` |
| `dashboard` | La consola web | **sólo loopback** |
| `coturn` | STUN/TURN: descubrimiento de NAT | host, UDP 3478 |

```bash
# env/host.env del nodo primario
ADC_INFRA_COMPOSE=mongo,redis,garage,rabbit,haraka,netbird
NETBIRD_BIND_HOST=0.0.0.0        # interfaz por la que los peers lo alcanzan
NETBIRD_PUBLIC_PORT=33443        # NO 443: ese ya lo sirve el gateway de la plataforma
NETBIRD_SIGNAL_PORT=33080
NETBIRD_RELAY_PORT=33081
NETBIRD_TURN_EXTERNAL_IP=        # ⚠️ la IP PÚBLICA si esta máquina está detrás de NAT

# env/network.env (igual en todos los nodos)
ADC_NETBIRD_DOMAIN=vpn.midominio.com
ADC_NODE_JOIN_CIDRS=100.64.0.0/10
NETBIRD_AUTH_OIDC_CONFIGURATION_ENDPOINT=…   # ← sin esto no arranca nadie

# env/secrets.env, sólo en el primario (openssl rand -base64 32 cada uno)
NETBIRD_DATASTORE_ENC_KEY=
NETBIRD_RELAY_AUTH_SECRET=
NETBIRD_TURN_PASSWORD=
```

**Puerto propio y no el 443.** El plano de control habla gRPC sobre HTTP/2, que el proxy de
streaming del kernel no reenvía; con una sola IP pública, la salida es un segundo puerto. El
certificado se reusa del que ya sirve la plataforma (`SSL_CERT_PATH`/`SSL_KEY_PATH`), y por eso el
compose no usa Let's Encrypt: si no, pelearía por el 80 para el desafío HTTP-01.

**Los tres secretos tienen que coincidir entre contenedores**, y los dos últimos son la única parte
de esto que falla en silencio:

| Secreto | Si no coincide |
| ------- | -------------- |
| `NETBIRD_DATASTORE_ENC_KEY` | (no se comparte; cifra el volumen del management) |
| `NETBIRD_RELAY_AUTH_SECRET` | los peers conectan y el relay los rechaza: «la red anda pero algunos no se alcanzan» |
| `NETBIRD_TURN_PASSWORD` | el descubrimiento de NAT falla y todo cae al relay: la red anda y es lenta |

No hace falta escribirlos en ningún archivo de configuración: el `management.json` y el
`turnserver.conf` los arma el propio stack al arrancar, desde el entorno. Si falta alguno, el
contenedor **corta con un error que dice cuál y qué se rompe sin él** en vez de levantar con un
default — un plano de control con secretos previsibles es peor que uno caído, porque parece que anda.

> El dashboard y el API de administración quedan atados a `127.0.0.1` y no se publican nunca. El
> único que los habla es el backend del panel. Para llegar al dashboard a mano: un túnel SSH al
> loopback del primario.

### Qué verificar antes de dar la fase por buena

Levantar los contenedores no prueba nada. Lo que hay que comprobar, en orden:

| Qué | Cómo | Qué tiene que pasar |
| --- | ---- | ------------------- |
| Los cinco contenedores están arriba | `docker compose ps` en `src/common/docker/adc-netbird-core` | management, signal, relay, dashboard y coturn, ninguno reiniciándose |
| La configuración se armó | `docker logs adc-netbird-management \| head -1` | `[netbird-config] configuración escrita en …` — si dice «Falta X», ese secreto no está |
| El dashboard NO está publicado | `curl http://vpn.midominio.com:33073/` **desde afuera** | falla (conexión rechazada) |
| El API responde por loopback | `curl -k https://127.0.0.1:33443/api/healthz` **en el primario** | responde |
| El TURN atiende | `docker logs adc-netbird-coturn \| grep realm` | el realm es tu dominio, y **cero** líneas `ERROR` |
| Un peer real levanta | `netbird status` en la máquina nueva | `Connected` |
| Los peers se ven entre sí | `ping <IP de overlay del otro nodo>` | responde |
| El tráfico NO pasa por el relay | `netbird status -d` en un peer | la conexión al otro peer dice `P2P`, no `Relayed` |
| El RPC del storage viaja por la overlay | `nc -z <IP de overlay> 3901` | abierto, y el 3901 público sigue cerrado |

> ⚠️ **El puerto importa y es fácil equivocarlo.** El API vive en **`:33443`**, no en el 443: ése lo
> sirve el gateway de la plataforma. Un `curl` sin puerto le pega al gateway, falla por el motivo
> equivocado y tacharía la casilla sin haber mirado nunca a NetBird. Un control que no controla es
> peor que ninguno, porque deja la sensación de que se verificó.

Los dos con incertidumbre real son los dos últimos de peers: el hole punching depende del NAT de
cada lado. Si un peer queda conectado pero la conexión figura como `Relayed`, la red anda y es
lenta. Las dos causas, en orden de probabilidad: falta `NETBIRD_TURN_EXTERNAL_IP` (la máquina está
detrás de NAT y el TURN anuncia una dirección interna), o falta abrir UDP 3478 en el firewall.

---

## 1b. Quién llega a qué (grupos y políticas)

Lo primero que hace el arranque, apenas guarda la credencial, es dejar la red con una **postura de
acceso** en vez de la malla completa que trae de fábrica:

| Grupo / política | Qué hace |
| ---------------- | -------- |
| grupo `nodos` | Las máquinas del clúster |
| grupo `personas` | Tus dispositivos: teléfono, portátil, PC de trabajo |
| «Nodos entre sí» | Los nodos se hablan en los dos sentidos y por todos los puertos (replicación, RPC, bus) |
| «Personas a nodos (SSH)» | Tus dispositivos llegan a los nodos **sólo por TCP/22**, y en un solo sentido |
| `Default` | **Se apaga.** Es la que permite todo entre todos |

Esa última fila es la que importa. Sin políticas la red no deja pasar nada, así que el servidor crea
una llamada `Default` que abre todo contra todo — y con ella puesta, el primer teléfono que entre ve
el 27017 de Mongo y el RPC del almacenamiento. Se deshabilita en vez de borrarse, para que se pueda
volver atrás mirando la lista.

Desde **Red privada → Quién llega a qué** se crean grupos nuevos (`hogar`, `trabajo`, lo que sea) y
sus políticas: origen, destino, protocolo, puertos y si vale en los dos sentidos. El botón
**Aplicar postura por defecto** es idempotente, así que también sirve de «restablecer».

> **En los dos sentidos** hace falta entre nodos y **no** entre un teléfono y un servidor: dejarlo
> apagado significa que el servidor no puede iniciar conexiones hacia el teléfono, que es justo lo
> que uno quiere de un dispositivo que anda por ahí.

### SSH sin abrir el puerto 22

Cada máquina tiene un interruptor **SSH** en su tarjeta. Es el SSH **del agente**, no el `sshd` del
sistema: la sesión la abre el agente y quién puede abrirla lo decide la política de la red. Con eso,
el 22 del host puede quedar cerrado incluso dentro de la red privada, y el acceso se da por grupo en
vez de repartiendo claves.

### Llegar a una máquina que no tiene el agente

Una LAN entera (o una VLAN) se publica en **Redes locales publicadas**: se elige una máquina de esa
red como **router**, se declara su rango (`192.168.1.0/24`, o el de la VLAN si querés sólo esa) y
los grupos que pueden alcanzarla.

Tres cosas que conviene saber antes:

- **El router de la casa no sirve** salvo que corra el agente (OpenWrt y derivados). Lo normal es
  designar una máquina que ya esté encendida en esa red.
- Esa máquina necesita **reenvío de IP** habilitado.
- El enmascarado viene activado, y es lo que evita tener que configurar rutas de vuelta en el router
  de la casa — que es el paso que nadie hace.

Con eso, el teléfono en el grupo `personas` (o en uno propio, `casa-movil`, con su política) entra a
la PC de escritorio por su IP de LAN sin que la PC tenga nada instalado.

## 2. Meter una máquina en la red

En el panel, **Red privada → Nueva clave**. El default es **un solo uso y un día de vigencia**: con
esa clave, cualquiera que la tenga mete una máquina en la red privada. El valor se ve **una sola
vez**; al listarlas, el servidor las devuelve enmascaradas.

En la máquina nueva, como root:

```bash
sudo node scripts/setup-node-vpn.mjs \
  --setup-key <la clave del panel> \
  --management-url https://vpn.midominio.com:33443 \
  --hostname torre
```

Instala `wireguard-tools` con el gestor de paquetes que haya (apt/dnf/yum/pacman/zypper/apk), baja
el instalador oficial del agente, registra el host y verifica. `--dry-run` muestra qué haría sin
ejecutar nada, y **no imprime la clave ni siquiera ahí**: un dry-run se corre para mostrárselo a
alguien, y ahí es donde un secreto termina en una captura de pantalla.

#### Si se queja del hash del instalador

El script baja el instalador oficial a un archivo, **le compara el SHA-256 contra el que tiene
aprobado y sólo entonces lo ejecuta**. Es el único código de terceros que corre acá, y corre como
root: sin esa comprobación la única garantía sería el TLS de la descarga.

Que falle no es raro ni es necesariamente un ataque — lo habitual es que NetBird haya publicado una
versión nueva—, pero no hay forma de distinguir una cosa de la otra sin mirar. El error deja el
archivo en disco y dice dónde. El procedimiento es leerlo, y si el contenido es legítimo, actualizar
`AGENT_INSTALLER_SHA256` en el script (queda versionado y revisado, que es lo que se quiere) o pasar
`--installer-sha256 <hash>` para una corrida puntual.

### Resistencia cuántica

Va **activada por defecto**, en modo permisivo: rota la clave compartida de WireGuard cada dos
minutos con un intercambio post-cuántico (Rosenpass), y los peers que no lo soporten —los móviles,
entre otros— siguen entrando con WireGuard normal.

Es la mitigación de *harvest now, decrypt later*: alguien graba hoy el tráfico entre nodos —la
replicación de Mongo, el RPC del almacenamiento— y lo abre dentro de diez años. X25519, que es lo
que usa WireGuard para el handshake, no sobrevive a eso; la clave compartida sí.

`--no-quantum-resistance` la apaga. **El flag existe a propósito**, aunque un interruptor para bajar
la seguridad siempre sea sospechoso: la función está marcada como experimental por sus autores, y
este script es lo que te da el SSH a esa máquina. Si tuviera un problema en ese kernel o esa distro
y la única forma de arreglarlo fuera editar un archivo en un host al que ya no podés entrar, la
trampa la habríamos construido nosotros. Cuando se usa, el script lo dice en rojo y explica qué se
está perdiendo.

---

## 3. Dar de alta el nodo en la plataforma

Tres caminos, del más corto al más explícito. El manual sigue existiendo y es el que no puede fallar.

### Guiado (**Nodos → Dar de alta un nodo**)

Hace de una vez lo que las secciones 2 y 3 describen por separado: corre los chequeos previos **al
abrir la pantalla** —y se niega a emitir si alguno bloquea, en vez de entregar credenciales a un
trámite que no puede terminar—, emite la clave de la red privada y el token del clúster juntos,
devuelve el comando del agente ya armado, y en cuanto el nodo aparece en la red completa solo el
bloque de `env/host.env` con la dirección que le tocó.

Lo que **no** hace es escribir ese archivo: entrega el texto y la máquina la configura su dueño. Y
tampoco suma el nodo a los motores con estado — eso sigue siendo el `rs.add()` y el
`garage layout assign` de siempre. El botón **Verificar este nodo** corre las cinco comprobaciones
del final (registro, `/healthz`, peer, replica set, layout) de una sola vez y es sólo lectura.

Emitir la clave de la red privada exige además permiso sobre la red privada (`network.vpn`
EXECUTE). Sin él, el alta entrega sólo el token y lo dice.

### Por token (el nodo se configura solo)

En el panel, **Nodos → Alta de nodo por token**. Se declara qué configuración recibe un nodo nuevo
en `Alta de nodo por token` (la plantilla `_template` la heredan todos; lo específico de un nodo se
aplica encima), se emite el token y se arranca la máquina nueva con **dos variables**:

```bash
# env/host.env del nodo nuevo — lo único que se escribe a mano
ADC_NODE_ID=torre
ADC_NODE_SITE=casa
ADC_NODE_ROLE=secondary
ADC_NODE_JOIN_URL=https://<IP de overlay del primario>:3000
ADC_NODE_JOIN_TOKEN=<el token del panel>
```

El kernel se detiene **antes de levantar infraestructura y antes de cargar un solo módulo**, canjea
el token, escribe lo que recibe en `env/` y recién ahí sigue arrancando. Si el clúster no contesta,
reintenta con backoff y termina abortando: un nodo que siguiera booteando sin configuración
levantaría su propio Mongo vacío en paralelo y nada avisaría hasta que alguien perdiera datos.

Tras el primer canje queda `env/.joined` y no se vuelve a intentar (el token ya no vale).

`ADC_NODE_ROLE=secondary` no es decorativo: el rol por defecto es `primary`, y un nodo que se diera
de alta creyéndose primario dejaría al clúster con dos —dos scheduler, dos juegos de watchers, dos
planos de control de la overlay— sin que nada fallara al arrancar. Por eso el canje lo verifica y
**corta el arranque** si el nodo se declara primario. El chequeo se hace después de `.joined`, así
que un secundario **promovido** desde el panel sigue arrancando aunque conserve estas variables.

**El grupo `host` no se entrega nunca.** Es lo que hace distinto a cada nodo —su identificador, su
sitio, su capacidad de almacenamiento—; mandarlo sería darle a una máquina la identidad de otra.

### Los tres rieles del canje, y por qué

| Riel | Qué evita |
| ---- | --------- |
| **Sólo desde la red privada** (`ADC_NODE_JOIN_CIDRS`) | Que un token filtrado alcance para entrar. Sin la lista configurada, el alta por token está **deshabilitada**: es un gate cuyo fallo abierto entregaría el clúster |
| **Un solo uso, atado a un `nodeId`** | Que el mismo token dé de alta una segunda máquina. El marcado de usado y la validación son la misma operación atómica, así que dos canjes simultáneos no pasan los dos |
| **Un solo canal para los secretos compartidos** | Que las catorce variables que tienen que ser idénticas terminen viajando por un `scp` y un portapapeles, sin dejar rastro. El canje las entrega **siempre**: hubo una bandera para no hacerlo, de cuando el canje podía llegar desde cualquier lado, y lo único que lograba era dar de alta un nodo a medias |

Todo canje y **todo rechazo** quedan auditados con la IP de origen. Un rechazo no dice qué rango se
espera: sería explicarle a quien está afuera cómo entrar.

### Sumar el nodo a los datos

Lo anterior le entrega al nodo su **configuración**. Sumarlo al replica set y darle lugar en el
layout del almacenamiento es otra cosa —son **datos**— y vive en **Nodos → Sumar un nodo a los
datos**: una máquina de estados con pre-flight, ensayo y pasos persistidos, igual que la conversión a
sharded, pero sin su ceremonia.

La diferencia es que **esta operación es reversible**: `rs.remove()` no borra un byte del miembro que
se saca y quitarle el rol del layout devuelve las particiones a donde estaban. Por eso no exige
ventana de mantenimiento ni backup declarado, y por eso el aborto no es un «hasta acá se puede» sino
la lista de lo que quedó por revertir. Los `remove` siguen sin dispararse desde una pantalla.

La operación inversa —**Nodos → Sacar un nodo de los datos**— existe por el mismo motivo y con los
mismos rieles: le quita el lugar en el layout (el clúster reparte sus particiones entre los que
quedan hasta volver al factor de replicación) y después lo saca del replica set. Tampoco borra nada,
y su ensayo trae el análisis que hace **el propio Garage** del layout resultante — que es además el
único lugar de la admin API donde aparece el factor de replicación. Lo que sí rechaza, sin poder
forzarse, es hacerlo sobre un clúster con particiones sin quórum: ahí sacar un nodo es lo que las
pierde.

Hay a lo sumo **una** operación de topología abierta a la vez, así que reconfigurar el replica set
mientras se lo convierte en shard —o sacar un nodo mientras se suma otro— es imposible por
construcción y no por acordarse.

### A mano (el runbook)

**Nodos → Generar runbook** emite los comandos exactos con las variables ya resueltas contra el
estado real del clúster, más la checklist de secretos que tienen que ser idénticos —de los que
lista los NOMBRES y de dónde copiarlos, nunca el valor—. Genera texto y no ejecuta nada.

---

## Probar un nodo antes de meterlo en los datos

**La forma segura es dejarlo sin motores.** En el panel, **Nodos → Estado**, se destilda todo: el
nodo no levanta ningún contenedor y se conecta al Mongo, Redis y Garage del clúster. Es un nodo de
aplicación puro — se le puede medir carga, latencia y estabilidad sin tocar la capa de datos. Cuando
convenza, se le marcan los motores y se los une.

Lo que **no** funciona es levantar los motores primero y unirlos después «cuando esté probado», y
por eso los init lo impiden:

| Motor | Qué hacía un secundario que arrancaba solo | Qué hace ahora |
| ----- | ------------------------------------------ | -------------- |
| Mongo | `rs.initiate()` → un `rs0` **propio y vacío**, en paralelo al del clúster | Se queda esperando el `rs.add()` desde el primario, y lo dice en su log |
| Garage | `layout assign` + `apply` → un **clúster de objetos propio** con su layout | Deja el servidor arriba y sin layout, e imprime los comandos exactos para el primario |

Ninguno de los dos fallaba: los dos arrancaban sanos, y el problema aparecía el día que alguien
buscaba un dato desde otro nodo y no estaba. El rol sale de `ADC_NODE_ROLE`, así que un secundario
está protegido por el solo hecho de declararse secundario.

## Qué motores levanta cada nodo

**En producción lo decide el panel, no `ADC_INFRA_COMPOSE`.** La variable se ignora y la decisión
vive en `env/node-state.json` del propio nodo, que es el único lugar que se puede leer antes de que
exista Mongo — la base que guardaría la decisión es uno de los contenedores que la decisión levanta.

La primera vez que un despliegue arranca sin ese archivo, se escribe con lo que dijera el entorno:
la migración no cambia el comportamiento de nadie. En desarrollo sigue mandando la variable, porque
ahí es una herramienta de iteración (`ADC_INFRA_COMPOSE=mongo bun run dev`).

Cambiar la selección surte efecto **al reiniciar**: los composes se deciden al arrancar. El panel
ofrece guardar para el próximo arranque o guardar y reiniciar ahora.

## En espera (standby)

**En espera** es un nodo vivo, en el registro y comandable, con sus motores arriba, pero **sin
cargar una sola app** y con `/healthz` respondiendo 503 `standby`.

Para qué sirve, en concreto: la máquina vuelve de un corte de luz, arranca sola con pm2 o systemd,
levanta su Mongo y se reincorpora al replica set —que es lo que uno quiere, para no quedar con la
copia degradada— y **no atiende una sola request** hasta que la enciendas desde el panel.

> **Sin la espera, «apagar» bajo un supervisor es «reiniciar».** pm2 y systemd vuelven a levantar lo
> que sale, así que el botón de apagado, con supervisor, se comporta como un botón de reinicio. El
> panel lo dice: muestra qué supervisor detectó (`pm_id` para pm2, `INVOCATION_ID` para systemd) o
> avisa de que no hay ninguno y que apagar deja la máquina apagada.

Los motores **sí** se levantan en espera, y es deliberado: son la copia de datos de ese nodo, y
dejarlos abajo mantendría el replica set degradado hasta que alguien se acuerde.

## Reparto de carga sin balanceador

Mientras no haya un balanceador en el DNS, un nodo que se retrasa puede pasarle trabajo a un vecino.
La condición es **presión, no tipo de request**, y ese matiz es el que hace que sirva:

- **Presión** = retraso del event loop, no CPU del host. Como el JavaScript es de un solo hilo, un
  temporizador de 250 ms que llega a los 400 significa 150 ms de trabajo encolado por delante de la
  próxima request. Eso es «el usuario está esperando»; el CPU de una máquina que además corre Mongo
  y dos bundlers está alto siempre y no dice nada.
- **No reparte por método.** Lo intuitivo —«las escrituras son pesadas, mandalas a otro nodo»— está
  al revés: una escritura tarda casi siempre por **Mongo**, que es compartido, así que el vecino le
  pega a la misma base y el desvío sólo suma un salto de red a la misma espera. Lo que sí se puede
  repartir es lo que consume *este proceso*: evaluar permisos sobre conjuntos grandes, serializar
  respuestas gordas, cifrar.
- **Tres condiciones, en orden**: este nodo retrasado (`ADC_OFFLOAD_HIGH_WATER`), un vecino
  sensiblemente menos cargado (`ADC_OFFLOAD_MARGIN`) y una ruta que cueste lo bastante como para que
  el salto valga la pena (`ADC_OFFLOAD_MIN_ROUTE_MS`, medido en vivo por ruta). Sin la primera
  desviar es puro costo; sin la segunda es mover la cola de lugar; sin la tercera el salto puede
  costar más que atender la request acá.

Nunca desvía SSE ni upgrades a websocket —abren un canal que vive minutos y mover ese estado fuera
del proceso es justo lo que la afinidad de conexión existe para evitar— ni cruza de sitio por
defecto.

**Con un balanceador administrado adelante no hay nada que apagar.** Con la carga ya repartida, la
presión de cada nodo no llega al umbral y la condición de entrada nunca se cumple: se autodesactiva.
`ADC_OFFLOAD_ENABLED=false` lo silencia del todo si se prefiere.

## Apagar un nodo

**Nodos → Apagar**, o `POST /api/network/nodes/:selector/shutdown`. El selector acepta el
identificador, un **alias** del nodo (`torre`) o un **grupo** (`@casa` = todos los nodos de ese
sitio); con un grupo, los apaga en serie y deja para el final el que está atendiendo.

El nodo sale primero de rotación, después cierra apps y módulos y **al final** la infraestructura,
con tiempo de sobra para que Mongo y el almacenamiento cierren sus archivos. Puede tardar minutos a
propósito: apagar puede ser lento, lo que no puede es corromper datos.

Si el nodo es la única copia en línea de algún motor, responde 409 con **qué** queda sin copia, y
hay que reenviar con `force: true`.

---

## Permisos

Recurso `network`, **global-only**: sus permisos sólo valen desde roles globales, y un admin de
organización no los porta aunque su usuario tenga roles globales.

| Scope | Qué habilita |
| ----- | ------------ |
| `nodes` | Lista de nodos, etiquetas y alias (UPDATE), runbook y tokens de alta (EXECUTE) |
| `topology` | Dónde viven los datos (replica set, layout del storage, réplicas de Redis, broker) |
| `vpn` | Peers, claves de alta y la credencial del plano de control |
| `integrity` | Informes de verificación de integridad |
| `lifecycle` | Apagar y drenar nodos |

El rol **Network Manager** los trae todos. Está separado del gestor de módulos a propósito: parar
una app es reversible en un click, apagar la máquina que la sirve no.

---

## La identidad

NetBird self-hosted **no tiene usuarios propios**: la consola y el API se autentican contra un
proveedor OIDC. Ese proveedor es **la plataforma**, que expone OpenID Connect desde
`SessionManagerService`. No hay un IdP más que operar, ni cuentas duplicadas, ni un segundo lugar
donde dar de baja a alguien que se va.

| Lo que publica la plataforma | Para qué |
| ---------------------------- | -------- |
| `GET /.well-known/openid-configuration` | Descubrimiento. Es lo único que hay que configurarle al consumidor |
| `GET /api/oidc/jwks` | Claves públicas de firma. Con esto el plano de control valida los tokens sin preguntarnos nada |
| `GET /api/oidc/authorize` | Inicio del login (code + PKCE). Sin sesión, manda al login de la plataforma |
| `POST /api/oidc/token` | Canje del código |
| `GET /api/oidc/userinfo` | Perfil del titular del token |

Sólo **authorization code con PKCE `S256`**. Nada de implicit, ni client credentials, ni registro
dinámico de clientes: los clientes se declaran a mano en el `private.oidc.clients` de
`SessionManagerService`, porque dar de alta clientes por API es dejar que cualquiera se anote para
recibir identidades.

Las variables de la red privada se derivan todas de `ADC_OIDC_ISSUER` (ver `env/network.env`), así
que cambiar el emisor obliga a cambiarlas juntas.

### El token de administración se emite a mano, una vez

El plano de control **no emite credenciales por API**: no hay arranque automatizable. Lo que sí es
real —y es la mayor parte del cliente— son `/api/peers`, `/api/setup-keys`, `/api/policies`,
`/api/groups` y `/api/routes`, que el panel usa tal cual. Lo único que falta es de dónde sale el
token, y son tres pasos, una sola vez por despliegue:

1. Túnel a la consola, que **no se publica**: `ssh -L 33073:127.0.0.1:33073 usuario@primario`.
2. Entrar a `http://localhost:33073` **con tu usuario de la plataforma** — la identidad la pone la
   plataforma, así que no hay ninguna cuenta que crear acá. El primer login es el dueño.
3. Emitir un token de acceso desde el perfil y pegarlo en el panel → **Red privada**.

Con el primer token el panel aplica además la postura de acceso por defecto. No es cosmético: la red
arranca con la malla completa de fábrica, donde el primer dispositivo que entra alcanza a todos los
demás, puertos de infraestructura incluidos.

---

Puertos en [ports.csv](ports.csv) (el panel es el 3048). El reparto de `env/` y qué se copia a otro
nodo, en [env/README.md](../../env/README.md).
