# IdentityManagerService

Servicio en modo kernel (`kernelMode: 60`) para gestión centralizada de identidades: usuarios, roles, grupos y organizaciones.

## Características

- Persistencia en MongoDB (provider `object/mongo`), fallback a memoria
- Contraseñas con PBKDF2 (100k iteraciones, salt 16 bytes)
- Permisos granulares por recurso/acción/alcance (`PermissionChecker`)
- `createAuthVerifier()` para validar tokens desde otros servicios
- Avatares vía `internal-s3-provider` + `attachments-utility`
- Soft-delete de usuarios con cron de purga (`scheduledDeletionAt`)
- Endpoints REST en `endpoints/` (users, groups, roles, orgs, stats)

Dependencias y configuración: ver `config.json`.
