# internal-s3-provider

Proveedor de almacenamiento de objetos compatible con S3 (minIO local o AWS S3 real) usando AWS SDK v3.

## Capacidades

- `putObject` / `getObjectStream` / `headObject` / `deleteObject`
- `getPresignedUploadUrl` / `getPresignedDownloadUrl`
- Auto-creación idempotente del bucket por defecto en `start()`
- Compatible con minIO (path-style) y AWS S3 (virtual-hosted)

## Configuración (`custom`)

```json
{
	"endpoint": "http://localhost:9000",
	"region": "us-east-1",
	"accessKey": "adcadmin",
	"secretKey": "adcpassword",
	"forcePathStyle": true,
	"defaultBucket": "adc-default",
	"presignTtl": 900
}
```
