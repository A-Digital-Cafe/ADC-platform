# Imagen del provisionador de Garage (`garage-init` del compose).
#
# Existe porque la imagen oficial de Garage NO trae shell (ni `/bin/sh`): es sólo el binario. El
# init necesita esperar al servidor, comparar estado y encadenar comandos, así que se copia el
# binario —estático— sobre una alpine con bash. Mismo patrón que `adc-haraka-core`.
FROM dxflrs/garage:v2.1.0 AS garage

FROM alpine:3.22
RUN apk add --no-cache bash && adduser -D -H -u 10001 garageinit
COPY --from=garage /garage /usr/local/bin/garage
COPY --chmod=0555 init.sh /usr/local/bin/init.sh

# Sin privilegios. El init sólo habla RPC y lee dos montajes de sólo lectura, así que no necesita
# root para nada — y sí gana algo con no tenerlo: comparte el volumen de metadatos con el servidor,
# donde `node_key` (la clave privada de RPC del nodo) vive 0600 y root la leería sin obstáculo.
# Este contenedor además recibe `GARAGE_RPC_SECRET` y las credenciales S3 por entorno.
USER garageinit
ENTRYPOINT ["/usr/local/bin/init.sh"]
