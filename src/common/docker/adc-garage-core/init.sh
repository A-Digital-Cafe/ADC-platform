#!/bin/bash
# Provisiona el clúster de Garage: layout, clave de servicio y buckets.
#
# Corre en cada `compose up` y es idempotente: si ya está todo, no toca nada. Equivale al
# `minio-init` que había antes, con una diferencia de fondo: Garage no implementa bucket policies
# (el modelo de MinIO/AWS), sino permisos por par clave↔bucket, así que en vez de una política JSON
# se conceden `--read --write` explícitos sobre cada bucket.
#
# No escribe NADA: lee la config y `node_key.pub` (ambos montados de sólo lectura) y todo lo demás
# lo hace por RPC contra el servidor. Es lo que le permite correr sin privilegios —ver el Dockerfile—
# y, en particular, no llegar nunca a `node_key`, la clave privada de RPC que vive 0600 al lado.
#
# Que el provisionamiento terminó lo publica el propio servidor: su healthcheck es `bucket list`, la
# operación más barata que exige un clúster con layout aplicado, así que no puede reportarse healthy
# antes de que esto termine. No hace falta ningún centinela.
set -uo pipefail

# La generada por `garage-config`, no la plantilla: es la única que tiene la región y el factor
# resueltos, y el CLI los necesita para hablar con el servidor.
CONFIG=/etc/garage/garage.toml
ZONE="${GARAGE_ZONE:-default}"
CAPACITY="${GARAGE_CAPACITY:-10G}"
RPC_TARGET="${GARAGE_RPC_TARGET:-garage:3901}"
ACCESS_KEY="${S3_ACCESS_KEY:-adc-platform}"
SECRET_KEY="${S3_SECRET_KEY:-adc-platform-dev}"
BUCKETS="${GARAGE_BUCKETS:-adc-drive adc-pm adc-mail adc-articles adc-avatars}"

log() { echo "[adc-garage-core-init] $*"; }
fail() { log "$*"; log "La plataforma NO va a poder acceder a S3."; exit 0; }

# El error del CLI se REENVÍA: al tragarlo, un fallo de formato de clave se veía como un
# "no se pudo importar" sin decir por qué, que es exactamente la pista que hace falta.
run() {
	local out
	if ! out=$(garage -c "$CONFIG" "$@" 2>&1); then
		log "garage $1 ${2:-} falló: $(echo "$out" | tail -2 | tr '\n' ' ')"
		return 1
	fi
	printf '%s' "$out"
}

# Garage no acepta cualquier par de credenciales, a diferencia de MinIO: el id es `GK` + 24
# dígitos hexadecimales y el secreto son 32 bytes en hexadecimal (64 caracteres). Se valida acá y
# no al fallar el import, porque el mensaje del servidor llega enterrado tres capas más abajo.
if [[ ! "$ACCESS_KEY" =~ ^GK[0-9a-fA-F]{24}$ ]]; then
	fail "S3_ACCESS_KEY='$ACCESS_KEY' no tiene el formato que exige Garage: 'GK' + 24 hex. Generar con: printf 'GK%s\\n' \"\$(openssl rand -hex 12)\""
fi
if [[ ! "$SECRET_KEY" =~ ^[0-9a-fA-F]{64}$ ]]; then
	fail "S3_SECRET_KEY no tiene el formato que exige Garage: 64 hex (32 bytes). Generar con: openssl rand -hex 32"
fi

# 1. El id del nodo sale de `node_key.pub`, que crea el servidor en su primer arranque: hay que
#    esperarlo. El volumen de metadatos se monta de sólo lectura justamente para leer esto.
node_full=""
for _ in $(seq 1 90); do
	node_full=$(garage -c "$CONFIG" node id -q 2>/dev/null | tr -d '[:space:]')
	[ -n "$node_full" ] && break
	sleep 1
done
[ -n "$node_full" ] || fail "No apareció el id del nodo tras 90 s."

node_id="${node_full%%@*}"
export GARAGE_RPC_HOST="${node_id}@${RPC_TARGET}"
log "nodo ${node_id:0:16}… vía ${RPC_TARGET}"

# 2. Esperar a que el servidor acepte RPC.
ready=0
for _ in $(seq 1 90); do
	if garage -c "$CONFIG" status >/dev/null 2>&1; then
		ready=1
		break
	fi
	sleep 1
done
[ "$ready" = "1" ] || fail "El servidor no respondió por RPC tras 90 s."

# 2b. Un SECUNDARIO no se provisiona a sí mismo: si asignara su propio layout formaría un clúster de
#     objetos PROPIO y vacío en paralelo al de verdad, los dos arrancarían sanos, y el fallo
#     aparecería el día que alguien busca desde otro nodo un archivo que este nodo sí tiene.
#
#     El alta la hace el PRIMARIO, único que conoce el layout vigente. Este init deja el servidor
#     arriba —su id sólo existe una vez arrancado— e imprime los dos comandos exactos. La clave de
#     servicio y los buckets son del clúster y llegan solos al unirse.
if [ "$(echo "${ADC_NODE_ROLE:-primary}" | tr '[:upper:]' '[:lower:]')" = "secondary" ]; then
	log "nodo secundario: NO se asigna layout ni se crean buckets (los formaría en un clúster propio)."
	log "Desde el PRIMARIO, para sumar este nodo al almacenamiento:"
	log "    garage node connect ${node_full}"
	log "    garage layout assign -z ${ZONE} -c ${CAPACITY} ${node_id}"
	log "    garage layout apply --version <actual + 1>"
	log "Hasta entonces este Garage está arriba y vacío, y no participa del clúster."
	exit 0
fi

# 3. Layout. `layout show` imprime la versión actual; aplicar exige pasar la SIGUIENTE, así que se
#    lee en vez de asumir 1 (si no, un segundo `compose up` fallaría o pisaría la versión buena).
# `layout show` imprime el id TRUNCADO a 16 caracteres, no el completo: buscar el id entero acá
# no matchea nunca y el layout se re-asignaba en cada `compose up`, subiendo la versión sin motivo.
if garage -c "$CONFIG" layout show 2>/dev/null | grep -q "${node_id:0:16}"; then
	log "layout ya asignado"
else
	current=$(garage -c "$CONFIG" layout show 2>/dev/null | grep -oiE 'layout version[: ]+[0-9]+' | grep -oE '[0-9]+' | head -1)
	current="${current:-0}"
	next=$((current + 1))
	run layout assign -z "$ZONE" -c "$CAPACITY" "$node_id" >/dev/null || fail "No se pudo asignar el layout."
	run layout apply --version "$next" >/dev/null || fail "No se pudo aplicar el layout (versión $next)."
	log "layout aplicado (zona $ZONE, capacidad $CAPACITY, versión $next)"
fi

# 4. Clave de servicio. Se IMPORTA con el par del `.env` en vez de dejar que Garage genere uno:
#    así rotar `S3_SECRET_KEY` y relevantar la infra alcanza, igual que con MinIO. Ojo: Garage no
#    permite reimportar una clave existente, así que rotar de verdad exige borrarla antes.
if garage -c "$CONFIG" key info "$ACCESS_KEY" >/dev/null 2>&1; then
	log "clave de servicio ya existente"
else
	run key import --yes -n adc-platform "$ACCESS_KEY" "$SECRET_KEY" >/dev/null ||
		fail "No se pudo importar la clave de servicio $ACCESS_KEY."
	log "clave de servicio importada"
fi

# 4b. Permiso de CREAR buckets. En Garage no viene con la clave (en MinIO lo daba la política
#     `s3:*` sobre `arn:aws:s3:::adc-*`), y sin él `internal-s3-provider.ensureBucket()` falla con
#     403 al arrancar CUALQUIER módulo cuyo bucket todavía no exista — que es el comportamiento
#     que la plataforma da por sentado ("los buckets por dominio se autocrean al arrancar").
run key allow --create-bucket "$ACCESS_KEY" >/dev/null ||
	fail "No se pudo habilitar la creación de buckets para $ACCESS_KEY."

# 5. Buckets + permisos. `bucket allow` es idempotente (fija banderas, no las suma).
for bucket in $BUCKETS; do
	if ! garage -c "$CONFIG" bucket info "$bucket" >/dev/null 2>&1; then
		run bucket create "$bucket" >/dev/null || fail "No se pudo crear el bucket $bucket."
	fi
	run bucket allow --read --write --owner "$bucket" --key "$ACCESS_KEY" >/dev/null ||
		fail "No se pudo dar permisos sobre $bucket a $ACCESS_KEY."
done
log "buckets listos: $BUCKETS"

log "provisionamiento completo"
exit 0
