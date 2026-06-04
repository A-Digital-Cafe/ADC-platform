#!/bin/sh
set -e

# Renderiza valores dependientes del entorno en la config de Haraka.
echo "${HARAKA_ME:-mail.tudominio.com}" > /app/config/me

# host_list: el dominio raíz y su forma con punto inicial para subdominios.
ROOT="${MAIL_ROOT_DOMAIN:-tudominio.com}"
{
	echo "${ROOT}"
	echo ".${ROOT}"
} > /app/config/host_list

# DKIM selector
echo "${DKIM_SELECTOR:-adcmail}" > /app/config/dkim_selector

# Variables consumidas por el plugin de webhook (adc_inbound_webhook).
{
	echo "url=${INBOUND_WEBHOOK_URL:-http://host.docker.internal:3000/api/email/inbound}"
	echo "secret=${INBOUND_WEBHOOK_SECRET:-change-me}"
} > /app/config/adc_inbound_webhook.ini

exec haraka -c /app
