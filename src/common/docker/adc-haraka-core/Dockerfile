FROM node:24-slim

RUN apt-get update \
	&& apt-get install -y --no-install-recommends ca-certificates libcap2-bin \
	&& rm -rf /var/lib/apt/lists/* \
	&& npm install --ignore-scripts -g Haraka@3.2.1 haraka-plugin-dkim@1.2.0 \
	&& rm -rf /usr/local/lib/node_modules/npm \
	/usr/local/lib/node_modules/corepack \
	/usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack

# Instalar Haraka globalmente. Versión fijada: un rebuild con `@3` a secas
# arrastró el breaking change de 3.2 (connection.ini) y dejó el MTA en crash-loop.
#
# `haraka-plugin-dkim` va aparte porque Haraka 3.2 sacó `dkim_sign` del core
# (hoy vive en ese paquete). Haraka lo resuelve como plugin `dkim` buscando en
# `<global node_modules>/haraka-plugin-dkim`, que es justo donde lo deja `-g`.

WORKDIR /app

# Config de Haraka (se renderiza con variables de entorno en el arranque)
COPY config ./config
COPY plugins ./plugins
COPY entrypoint.sh /entrypoint.sh
# `mkdir /app/queue` antes del chown: un volumen nombrado hereda dueño y permisos
# del directorio que exista en la imagen. Sin él, Docker lo crea como root y el
# encolado saliente muere con EACCES ("Unable to write queue file").
RUN mkdir -p /app/queue \
	&& chmod +x /entrypoint.sh \
	&& setcap 'cap_net_bind_service=+ep' "$(readlink -f "$(which node)")" \
	&& chown -R node:node /app /entrypoint.sh

# Ejecutar node como usuario sin privilegios. El usuario `node` ya existe en la imagen.
# Damos al binario de node la capacidad de enlazar puertos < 1024 para no necesitar root,
# y le cedemos la propiedad de los directorios que el entrypoint reescribe en el arranque.

# Sólo el 25 mientras no exista submission (el 587 se reabre con auth+TLS).
EXPOSE 25

USER node

ENTRYPOINT ["/entrypoint.sh"]
