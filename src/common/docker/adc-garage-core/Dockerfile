# Imagen del provisionador de Garage (`garage-init` del compose).
#
# Existe porque la imagen oficial de Garage NO trae shell (ni `/bin/sh`): es sólo el binario. El
# init necesita esperar al servidor, comparar estado y encadenar comandos, así que se copia el
# binario —estático— sobre una alpine con bash. Mismo patrón que `adc-haraka-core`.
#
# Tag Y digest: el digest fija el build (sin él, dos `build` en fechas distintas dan árboles
# distintos) y el tag deja verificable qué versión es, además de que `outdated_digest` sólo salte
# cuando el tag se mueve.
FROM dxflrs/garage:v2.1.0@sha256:4c9b34c113e61358466e83fd6e7d66e6d18657ede14b776eb78a93ee8da7cf6a AS garage

FROM alpine:3.22@sha256:14358309a308569c32bdc37e2e0e9694be33a9d99e68afb0f5ff33cc1f695dce
RUN apk add --no-cache bash && adduser -D -H -u 10001 garageinit
COPY --from=garage /garage /usr/local/bin/garage
COPY --chmod=0555 init.sh /usr/local/bin/init.sh
# La misma imagen sirve al servicio `garage-config`, que genera el `garage.toml` desde la plantilla
# antes de que arranque el servidor.
COPY --chmod=0555 render-config.sh /usr/local/bin/render-config.sh

# Sin privilegios: comparte el volumen de metadatos con el servidor, donde `node_key` (la clave
# privada de RPC del nodo) vive 0600 y root la leería sin obstáculo.
USER garageinit
ENTRYPOINT ["/usr/local/bin/init.sh"]
