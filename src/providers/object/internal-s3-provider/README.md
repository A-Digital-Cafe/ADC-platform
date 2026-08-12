# internal-s3-provider

Proveedor de almacenamiento de objetos compatible con S3 (minIO local o AWS S3 real) usando AWS SDK v3.

## Capacidades

- `putObject` / `getObjectStream` / `headObject` / `deleteObject`
- `getPresignedUploadUrl` / `getPresignedDownloadUrl` — con `publicHost` (host del request) firman
  contra ese host si el endpoint es local, para que las URLs sirvan desde otro dispositivo de la LAN
- El PUT presignado guarda `Content-Disposition: attachment` en el objeto (firmado: el cliente
  tiene que mandar los `headers` del presign tal cual). Las descargas lo pisan con
  `response-content-disposition`, así que las previews siguen inline
- Auto-creación idempotente del bucket por defecto en `start()`
- Compatible con Garage (path-style) y AWS S3 (virtual-hosted)

## Configuración (`custom`)

Los defaults del provider apuntan al Garage local (`adc-garage-core`). Un módulo **no** repite esos
valores en su `config.json`: deja `${S3_ENDPOINT}` / `${S3_ACCESS_KEY}` / `${S3_SECRET_KEY}` sin
default propio, o un cambio de motor deja atrás una copia obsoleta que sólo falla en runtime.

```json
{
	"endpoint": "http://localhost:3900",
	"region": "sa-central-1",
	"accessKey": "GK…24 hex",
	"secretKey": "…64 hex",
	"forcePathStyle": true,
	"defaultBucket": "adc-default",
	"presignTtl": 900
}
```

Las credenciales son las de una **cuenta de servicio acotada a los buckets `adc-*`**, nunca las del
root: el access key viaja en cada URL presignada. En dev la provisiona `adc-minio-core`; en producción
hay que crear el usuario IAM/service account equivalente y pasar `S3_ACCESS_KEY`/`S3_SECRET_KEY`.
