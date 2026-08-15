#!/bin/sh
# Genera el `management.json` del plano de control y arranca el servidor.
#
# El `management.json` lleva **secretos adentro** (clave de cifrado del almacén, secreto del relay,
# contraseña del TURN) y el binario no los lee del entorno: de las ~20 variables `NB_*` que reconoce
# la imagen v0.62.0, ninguna es ésas. Así que el repo versiona la **forma** de la configuración y
# los valores llegan por entorno, igual que en el `init.sh` del almacenamiento.
#
# No inventa secretos: si falta alguno corta diciendo cuál, porque un plano de control con secretos
# previsibles parece que anda y es peor que uno caído.

set -eu

CONFIG_PATH="${NB_CONFIG_PATH:-/var/lib/netbird/management.json}"

fail() {
	echo "[netbird-config] $1" >&2
	exit 1
}

require() {
	# $1 = nombre, $2 = valor, $3 = qué se rompe sin él
	[ -n "$2" ] || fail "Falta \`$1\`. $3"
}

require "NETBIRD_DATASTORE_ENC_KEY" "${NETBIRD_DATASTORE_ENC_KEY:-}" \
	"Es la clave con la que el plano de control cifra su almacén (claves de alta, tokens). Sin ella, quien lea el volumen se lleva las credenciales de la red entera. Generala con \`openssl rand -base64 32\`."
require "NETBIRD_RELAY_AUTH_SECRET" "${NETBIRD_RELAY_AUTH_SECRET:-}" \
	"Tiene que ser EL MISMO que el del contenedor del relay. Si no coinciden, los peers conectan y el relay los rechaza, y eso se ve como 'la red anda pero algunos no se alcanzan'."
require "NETBIRD_TURN_PASSWORD" "${NETBIRD_TURN_PASSWORD:-}" \
	"Tiene que ser LA MISMA que la del \`turnserver.conf\`. Sin coincidencia, el descubrimiento de NAT falla y todo el tráfico cae al relay: la red anda y es lenta."
require "ADC_NETBIRD_DOMAIN" "${ADC_NETBIRD_DOMAIN:-}" \
	"Es el dominio por el que los peers alcanzan a este servidor, y viaja adentro de la configuración que reciben."
require "NETBIRD_AUTH_OIDC_CONFIGURATION_ENDPOINT" "${NETBIRD_AUTH_OIDC_CONFIGURATION_ENDPOINT:-}" \
	"NetBird self-hosted NO tiene usuarios propios: delega la identidad en un OIDC externo. Sin esto el servidor arranca y nadie puede autenticarse contra su API."
require "NETBIRD_AUTH_CLIENT_ID" "${NETBIRD_AUTH_CLIENT_ID:-}" \
	"Es el cliente OIDC con el que se autentican la consola y el API."

TURN_DOMAIN="${NETBIRD_TURN_DOMAIN:-$ADC_NETBIRD_DOMAIN}"
TURN_USER="${NETBIRD_TURN_USER:-netbird}"
SIGNAL_PORT="${NETBIRD_SIGNAL_PORT:-33080}"
RELAY_PORT="${NETBIRD_RELAY_PORT:-33081}"
AUTH_AUDIENCE="${NETBIRD_AUTH_AUDIENCE:-$NETBIRD_AUTH_CLIENT_ID}"
AUTH_SCOPES="${NETBIRD_AUTH_SUPPORTED_SCOPES:-openid profile email offline_access api}"
# `DisableDefaultPolicy` en true es lo que evita que la red nazca con una política que permite todo
# entre todos: el primer teléfono que entrara vería el 27017 de Mongo y el RPC del almacenamiento.
DISABLE_DEFAULT_POLICY="${NETBIRD_MGMT_DISABLE_DEFAULT_POLICY:-true}"

# Sin `--cert-file`, el management sirve en claro y `Signal.Proto` tiene que acompañar, o los peers
# intentan TLS contra un puerto que no lo habla y el fallo aparece del lado del cliente.
if [ -s /etc/netbird/tls/cert.pem ]; then
	SIGNAL_PROTO="https"
	CERT_FILE="/etc/netbird/tls/cert.pem"
	CERT_KEY="/etc/netbird/tls/key.pem"
else
	echo "[netbird-config] sin certificado montado (SSL_CERT_PATH): el plano de control va a servir SIN TLS. Sólo para probar en una LAN." >&2
	SIGNAL_PROTO="http"
	CERT_FILE=""
	CERT_KEY=""
fi

mkdir -p "$(dirname "$CONFIG_PATH")"
cat >"$CONFIG_PATH" <<EOF
{
  "Stuns": [
    { "Proto": "udp", "URI": "stun:${TURN_DOMAIN}:3478", "Username": "", "Password": null }
  ],
  "TURNConfig": {
    "Turns": [
      { "Proto": "udp", "URI": "turn:${TURN_DOMAIN}:3478", "Username": "${TURN_USER}", "Password": "${NETBIRD_TURN_PASSWORD}" }
    ],
    "CredentialsTTL": "12h",
    "Secret": "${NETBIRD_TURN_PASSWORD}",
    "TimeBasedCredentials": false
  },
  "Relay": {
    "Addresses": ["rel://${ADC_NETBIRD_DOMAIN}:${RELAY_PORT}"],
    "CredentialsTTL": "24h",
    "Secret": "${NETBIRD_RELAY_AUTH_SECRET}"
  },
  "Signal": {
    "Proto": "${SIGNAL_PROTO}",
    "URI": "${ADC_NETBIRD_DOMAIN}:${SIGNAL_PORT}",
    "Username": "",
    "Password": null
  },
  "ReverseProxy": {
    "TrustedHTTPProxies": [],
    "TrustedHTTPProxiesCount": 0,
    "TrustedPeers": ["0.0.0.0/0"]
  },
  "DisableDefaultPolicy": ${DISABLE_DEFAULT_POLICY},
  "Datadir": "",
  "DataStoreEncryptionKey": "${NETBIRD_DATASTORE_ENC_KEY}",
  "StoreConfig": { "Engine": "sqlite" },
  "HttpConfig": {
    "AuthIssuer": "${NETBIRD_AUTH_AUTHORITY:-}",
    "AuthAudience": "${AUTH_AUDIENCE}",
    "AuthUserIDClaim": "${NETBIRD_AUTH_USER_ID_CLAIM:-sub}",
    "CertFile": "${CERT_FILE}",
    "CertKey": "${CERT_KEY}",
    "IdpSignKeyRefreshEnabled": true,
    "OIDCConfigEndpoint": "${NETBIRD_AUTH_OIDC_CONFIGURATION_ENDPOINT}"
  },
  "IdpManagerConfig": {
    "ManagerType": "${NETBIRD_MGMT_IDP:-none}",
    "ClientConfig": {
      "Issuer": "${NETBIRD_AUTH_AUTHORITY:-}",
      "TokenEndpoint": "${NETBIRD_AUTH_TOKEN_ENDPOINT:-}",
      "ClientID": "${NETBIRD_IDP_MGMT_CLIENT_ID:-$NETBIRD_AUTH_CLIENT_ID}",
      "ClientSecret": "${NETBIRD_IDP_MGMT_CLIENT_SECRET:-}",
      "GrantType": "client_credentials"
    },
    "ExtraConfig": {}
  },
  "PKCEAuthorizationFlow": {
    "ProviderConfig": {
      "Audience": "${AUTH_AUDIENCE}",
      "ClientID": "${NETBIRD_AUTH_CLIENT_ID}",
      "ClientSecret": "${NETBIRD_AUTH_CLIENT_SECRET:-}",
      "Domain": "",
      "AuthorizationEndpoint": "${NETBIRD_AUTH_PKCE_AUTHORIZATION_ENDPOINT:-}",
      "TokenEndpoint": "${NETBIRD_AUTH_TOKEN_ENDPOINT:-}",
      "Scope": "${AUTH_SCOPES}",
      "RedirectURLs": ["http://localhost:53000"],
      "UseIDToken": false,
      "DisablePromptLogin": false,
      "LoginFlag": 0
    }
  }
}
EOF
chmod 600 "$CONFIG_PATH"
echo "[netbird-config] configuración escrita en $CONFIG_PATH (TLS: ${SIGNAL_PROTO})" >&2

exec /go/bin/netbird-mgmt management --config "$CONFIG_PATH" "$@"
