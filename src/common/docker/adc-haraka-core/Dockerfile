FROM node:20-slim

RUN apt-get update \
	&& apt-get install -y --no-install-recommends ca-certificates \
	&& rm -rf /var/lib/apt/lists/*

# Instalar Haraka globalmente
RUN npm install -g Haraka@3

WORKDIR /app

# Config de Haraka (se renderiza con variables de entorno en el arranque)
COPY config ./config
COPY plugins ./plugins
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

EXPOSE 25 587

ENTRYPOINT ["/entrypoint.sh"]
