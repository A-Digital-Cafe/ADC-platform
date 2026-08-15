#!/bin/sh
# Genera el `turnserver.conf` del STUN/TURN y arranca coturn.
#
# Existe por lo mismo que su hermano `render-config.sh`: la configuración lleva la contraseña del
# TURN adentro (`user=<usuario>:<contraseña>`) y este repo está en git. Pasarla por `--user` sería
# peor: con `network_mode: host` la ve cualquiera que corra `ps`, y queda en el `docker inspect`.
#
# Tiene que ser la misma que la de `management.json`, porque el plano de control se la reparte a los
# peers: si no coinciden, el descubrimiento de NAT falla y todo el tráfico cae al relay, o sea que
# la red anda y es lenta.

set -eu

CONFIG_PATH="${TURN_CONFIG_PATH:-/var/tmp/turnserver.conf}"

if [ -z "${NETBIRD_TURN_PASSWORD:-}" ]; then
	echo "[coturn-config] Falta \`NETBIRD_TURN_PASSWORD\`. Tiene que ser la misma que ve el plano de control; generala con \`openssl rand -base64 32\`." >&2
	exit 1
fi

TURN_USER="${NETBIRD_TURN_USER:-netbird}"
# Rango de puertos de las asignaciones. Acotado a propósito: el default de coturn abre 49152-65535,
# que en un firewall es un agujero mucho más grande del que hace falta.
MIN_PORT="${NETBIRD_TURN_MIN_PORT:-49152}"
MAX_PORT="${NETBIRD_TURN_MAX_PORT:-49472}"

# Detrás de un NAT (lo normal en casa), coturn tiene que anunciar la dirección PÚBLICA y no la de su
# interfaz, o las candidatas que reparte son inalcanzables y el hole punching falla siempre.
if [ -n "${NETBIRD_TURN_EXTERNAL_IP:-}" ]; then
	EXTERNAL_IP_LINE="external-ip=${NETBIRD_TURN_EXTERNAL_IP}"
else
	EXTERNAL_IP_LINE="# external-ip sin declarar: correcto sólo si esta máquina tiene IP pública directa"
	echo "[coturn-config] sin NETBIRD_TURN_EXTERNAL_IP: si esta máquina está detrás de NAT, el descubrimiento va a fallar y todo el tráfico va a caer al relay." >&2
fi

cat >"$CONFIG_PATH" <<EOF
listening-port=3478
${EXTERNAL_IP_LINE}
min-port=${MIN_PORT}
max-port=${MAX_PORT}
fingerprint
lt-cred-mech
user=${TURN_USER}:${NETBIRD_TURN_PASSWORD}
realm=${ADC_NETBIRD_DOMAIN:-netbird.selfhosted}
log-file=stdout
no-software-attribute
pidfile="/var/tmp/turnserver.pid"
# No se levanta el listener TLS: NetBird usa STUN/TURN en UDP 3478 y nada más, así que el 5349 sería
# superficie abierta sin usar. DTLS ya no arranca salvo que se pida (`--dtls`), así que no hace falta
# apagarlo — `no-dtls` está deprecada y sólo agrega un aviso por arranque.
# Tampoco va `no-cli`: la CLI es OFF por defecto en 4.x y la opción quedó deprecada.
no-tls
EOF
chmod 600 "$CONFIG_PATH"
echo "[coturn-config] configuración escrita en $CONFIG_PATH (usuario ${TURN_USER}, puertos ${MIN_PORT}-${MAX_PORT})" >&2

exec turnserver -c "$CONFIG_PATH" "$@"
