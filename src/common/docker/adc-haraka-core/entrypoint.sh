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

# Variables consumidas por el plugin de webhook (adc_inbound_webhook).
{
	echo "url=${INBOUND_WEBHOOK_URL:-http://host.docker.internal:3000/api/email/inbound}"
	echo "secret=${INBOUND_WEBHOOK_SECRET:-change-me}"
} > /app/config/adc_inbound_webhook.ini

exec haraka -c /app
