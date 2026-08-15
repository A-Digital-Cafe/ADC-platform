#!/bin/bash
# Genera el `garage.toml` final desde `garage.toml.tmpl` y el entorno, antes de que arranque el
# servidor.
#
# Existe porque Garage no lee del entorno nada que no sea un secreto: el factor de replicación, la
# dirección con la que el nodo se anuncia y la región salen sí o sí del archivo (comprobado contra
# v2.1.0: exportar `GARAGE_REPLICATION_FACTOR` no cambia nada y no avisa).
#
# Va en un contenedor aparte y no en el entrypoint del servidor porque la imagen de Garage **no trae
# shell**: es sólo el binario estático. El servidor espera a que termine
# (`service_completed_successfully`).
#
# No escribe secretos: el archivo generado queda legible para el provisionador, que corre sin
# privilegios.
set -euo pipefail

TEMPLATE=${GARAGE_CONFIG_TEMPLATE:-/etc/garage-template/garage.toml.tmpl}
OUTPUT=${GARAGE_CONFIG_OUTPUT:-/etc/garage/garage.toml}

log() { echo "[adc-garage-core-config] $*" >&2; }

# Un valor mal puesto acá tumba el arranque con un error de parseo del TOML, que es mucho más difícil
# de leer que esto. El factor además se valida contra lo que Garage acepta.
factor=${GARAGE_REPLICATION_FACTOR:-1}
if ! [[ $factor =~ ^[0-9]+$ ]] || [ "$factor" -lt 1 ]; then
	log "GARAGE_REPLICATION_FACTOR='$factor' no es un entero >= 1."
	exit 1
fi
if [ "$factor" = "2" ]; then
	# No es una opinión de estilo: con factor 2 el quórum de escritura son las dos copias, así que
	# perder un nodo bloquea las escrituras y se paga el doble de disco sin ganar tolerancia. Garage
	# lo acepta; acá no, porque el único camino de vuelta es la migración con ventana.
	log "GARAGE_REPLICATION_FACTOR=2 no está permitido: bloquea las escrituras al caer un nodo y cuesta el doble de disco sin tolerar fallos. Usá 1 o 3."
	exit 1
fi

rpc_addr=${GARAGE_RPC_PUBLIC_ADDR:-127.0.0.1:3901}
region=${S3_REGION:-sa-central-1}

if [ ! -r "$TEMPLATE" ]; then
	log "No se puede leer la plantilla en $TEMPLATE."
	exit 1
fi

mkdir -p "$(dirname "$OUTPUT")"
# `sed` y no `envsubst`: la plantilla es un TOML con `${...}` sólo en tres lugares y envsubst no está
# en la imagen. Los valores están validados arriba, así que no hay nada que escapar.
sed -e "s|\${GARAGE_REPLICATION_FACTOR}|${factor}|g" \
	-e "s|\${GARAGE_RPC_PUBLIC_ADDR}|${rpc_addr}|g" \
	-e "s|\${S3_REGION}|${region}|g" \
	"$TEMPLATE" >"$OUTPUT.incoming"

if grep -q '\${' "$OUTPUT.incoming"; then
	log "Quedaron marcadores sin reemplazar en la plantilla: $(grep -o '\${[A-Z_]*}' "$OUTPUT.incoming" | sort -u | tr '\n' ' ')"
	exit 1
fi

# Reemplazo atómico: si el servidor estuviera leyendo el archivo viejo, nunca ve uno a medio escribir.
mv "$OUTPUT.incoming" "$OUTPUT"
chmod 0644 "$OUTPUT"
log "configuración escrita en $OUTPUT (factor $factor, anuncio $rpc_addr, región $region)"
