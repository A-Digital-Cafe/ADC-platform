#!/bin/sh
set -e

# Renderiza valores dependientes del entorno en la config de Haraka.
echo "${HARAKA_ME:-mail.adigitalcafe.com}" > /app/config/me

ROOT="${MAIL_ROOT_DOMAIN:-adigitalcafe.com}"

# Destinatarios locales aceptados. `rcpt_to.in_host_list` compara host_list por
# igualdad exacta (no por sufijo), así que los subdominios de organización van
# por host_list_regex; el anclado ^(?:…)$ lo agrega Haraka.
echo "${ROOT}" > /app/config/host_list
echo ".*\\.$(echo "${ROOT}" | sed 's/\./\\./g')" > /app/config/host_list_regex

# Clave DKIM: se monta de solo lectura en /app/secrets/dkim y se copia al layout
# que espera haraka-plugin-dkim (config/dkim/<dominio>/{private,selector}).
# Sin clave montada no se firma: queda el aviso y el MTA sigue entregando.
DKIM_DIR="/app/config/dkim/${ROOT}"
if [ -f /app/secrets/dkim/private ]; then
	mkdir -p "${DKIM_DIR}"
	cp /app/secrets/dkim/private "${DKIM_DIR}/private"
	chmod 600 "${DKIM_DIR}/private"
	echo "${DKIM_SELECTOR:-adcmail}" > "${DKIM_DIR}/selector"
else
	echo "[entrypoint] AVISO: no hay clave DKIM en /app/secrets/dkim/private; el correo saliente no se firmará" >&2
fi

# STARTTLS: el plugin `tls` sólo se habilita si hay certificado montado en
# /app/secrets/tls (cert.pem + key.pem, p. ej. fullchain/privkey de Let's
# Encrypt renombrados). Se copian al config dir con los nombres por defecto
# del plugin y se descomenta su línea en config/plugins. Sin certs, el MTA
# arranca en claro como siempre (la línea queda comentada).
if [ -f /app/secrets/tls/cert.pem ] && [ -f /app/secrets/tls/key.pem ]; then
	cp /app/secrets/tls/cert.pem /app/config/tls_cert.pem
	cp /app/secrets/tls/key.pem /app/config/tls_key.pem
	chmod 600 /app/config/tls_key.pem
	sed -i 's/^# tls$/tls/' /app/config/plugins
	echo "[entrypoint] TLS habilitado (STARTTLS) con el certificado montado"
else
	echo "[entrypoint] AVISO: sin certificado en /app/secrets/tls (cert.pem+key.pem); STARTTLS deshabilitado" >&2
fi

# Conexión a Redis para haraka-plugin-redis, del que hereda `limit`. Va en redis.ini y no en la
# sección [redis] de limit.ini para que ese archivo quede con la POLÍTICA (qué se limita y cuánto)
# y no con la topología, que cambia por despliegue. El plugin mueve host/port a `socket.*` solo.
{
	echo "[server]"
	echo "host=${REDIS_HOST:-adc-redis-core}"
	echo "port=${REDIS_PORT:-6379}"
	# `username`/`password` no están en la lista de opciones de socket del plugin, así que llegan
	# tal cual a node-redis, que es donde van. `if` y no `[ … ] && echo`: con `set -e`, un test
	# falso devuelve 1 y abortaría el entrypoint.
	if [ -n "${REDIS_USER:-}" ]; then
		echo "username=${REDIS_USER}"
	fi
	if [ -n "${REDIS_PASSWORD:-}" ]; then
		echo "password=${REDIS_PASSWORD}"
	fi
} > /app/config/redis.ini
# Legible sólo por el dueño: lleva la credencial del MTA.
chmod 600 /app/config/redis.ini

# Variables consumidas por el plugin de webhook (adc_inbound_webhook).
{
	echo "url=${INBOUND_WEBHOOK_URL:-http://host.docker.internal:3000/api/email/inbound}"
	echo "secret=${INBOUND_WEBHOOK_SECRET:-change-me}"
} > /app/config/adc_inbound_webhook.ini

exec haraka -c /app
