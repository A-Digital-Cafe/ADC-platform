# Tag Y digest: el digest fija el build (el tag se reescribe con cada release de la 24.x) y el tag
# deja verificable qué versión es, además de que `outdated_digest` sólo salte cuando el tag se mueve.
# Alpine y no `-slim`: la base Debian arrastra CVEs sin parche en glibc y perl-base que `apt-get
# upgrade` no toca. Lo que el escáner marque acá viene de los gestores de paquetes de la imagen de
# Node; el `rm -rf` de abajo los saca de la imagen final, pero el aviso apunta a la base.
FROM node:24-alpine@sha256:d32cdf619f63fe0471182d08996dd516c6275bb5fd31ae06e55a570bd9e1ad43

# Haraka fijada a 3.2.1: un rebuild con `@3` arrastró el breaking change de 3.2 (connection.ini) y
# dejó el MTA en crash-loop. `haraka-plugin-dkim` va aparte porque 3.2 sacó `dkim_sign` del core y
# Haraka lo busca en `<global node_modules>`, que es donde lo deja `-g`. `libcap` trae el `setcap` de
# más abajo. Se borran los tres gestores de paquetes: un MTA no instala nada en caliente y son lo
# único que arrastra dependencias con CVEs.
RUN apk add --no-cache ca-certificates libcap \
	&& npm install --ignore-scripts -g Haraka@3.2.1 haraka-plugin-dkim@1.2.0 \
	&& rm -rf /usr/local/lib/node_modules/npm \
	/usr/local/lib/node_modules/corepack \
	/opt/yarn-* \
	/usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack \
	/usr/local/bin/yarn /usr/local/bin/yarnpkg

WORKDIR /app

# El entrypoint renderiza la config con variables de entorno en el arranque.
COPY config ./config
COPY plugins ./plugins
COPY entrypoint.sh /entrypoint.sh

# `mkdir /app/queue` antes del chown: un volumen nombrado hereda dueño y permisos de lo que exista
# en la imagen, y sin él Docker lo crea como root y el encolado muere con EACCES. El setcap deja a
# node enlazar puertos < 1024 sin ser root.
RUN mkdir -p /app/queue \
	&& chmod +x /entrypoint.sh \
	&& setcap 'cap_net_bind_service=+ep' "$(readlink -f "$(which node)")" \
	&& chown -R node:node /app /entrypoint.sh

# Sólo el 25 mientras no exista submission (el 587 se reabre con auth+TLS).
EXPOSE 25

USER node

ENTRYPOINT ["/entrypoint.sh"]
