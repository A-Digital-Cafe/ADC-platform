FROM node:24-slim

RUN apt-get update \
	&& apt-get install -y --no-install-recommends ca-certificates libcap2-bin \
	&& rm -rf /var/lib/apt/lists/* \
	&& npm install --ignore-scripts -g Haraka@3.2.1 \
	&& rm -rf /usr/local/lib/node_modules/npm \
	/usr/local/lib/node_modules/corepack \
	/usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack

# Instalar Haraka globalmente. Versión fijada: un rebuild con `@3` a secas
# arrastró el breaking change de 3.2 (connection.ini) y dejó el MTA en crash-loop.

WORKDIR /app

# Config de Haraka (se renderiza con variables de entorno en el arranque)
COPY config ./config
COPY plugins ./plugins
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh \
	&& setcap 'cap_net_bind_service=+ep' "$(readlink -f "$(which node)")" \
	&& chown -R node:node /app /entrypoint.sh

# Ejecutar node como usuario sin privilegios. El usuario `node` ya existe en la imagen.
# Damos al binario de node la capacidad de enlazar puertos < 1024 para no necesitar root,
# y le cedemos la propiedad de los directorios que el entrypoint reescribe en el arranque.

EXPOSE 25 587

USER node

ENTRYPOINT ["/entrypoint.sh"]
