FROM node:20-slim

RUN apt-get update \
	&& apt-get install -y --no-install-recommends ca-certificates libcap2-bin \
	&& rm -rf /var/lib/apt/lists/*

# Instalar Haraka globalmente
RUN npm install -g Haraka@3

WORKDIR /app

# Config de Haraka (se renderiza con variables de entorno en el arranque)
COPY config ./config
COPY plugins ./plugins
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

# Ejecutar como usuario sin privilegios. El usuario `node` ya existe en la imagen.
# Damos al binario de node la capacidad de enlazar puertos < 1024 para no necesitar root,
# y le cedemos la propiedad de los directorios que el entrypoint reescribe en el arranque.
RUN setcap 'cap_net_bind_service=+ep' "$(readlink -f "$(which node)")" \
	&& chown -R node:node /app /entrypoint.sh

EXPOSE 25 587

USER node

ENTRYPOINT ["/entrypoint.sh"]
