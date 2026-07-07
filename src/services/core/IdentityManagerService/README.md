# IdentityManagerService

Servicio kernel (`kernelMode: 60`) para identidad: usuarios, roles, grupos y organizaciones (multi-tenant vía `forOrg`).

- Persistencia MongoDB (`object/mongo`); contraseñas PBKDF2 (100k iteraciones, salt 16 bytes)
- Permisos granulares recurso/acción/alcance (`PermissionChecker`); recursos `globalOnly` (security, modules) sólo valen desde **roles globales**
- **Jerarquía de roles** (mayor = más autoridad): nadie gestiona usuarios/roles de jerarquía ≥ a la propia ni a sí mismo (`domain/hierarchy.ts`)
- Roles predefinidos **sincronizados en boot** desde `defaults/systemRoles.ts` (la matriz rol × permisos vive ahí)
- `createAuthVerifier()` para validar tokens desde otros servicios; alertas `security.alert` a Admins/Security Managers globales (`notify.ts`)
- Avatares vía `internal-s3-provider` + `attachments-utility`; soft-delete de usuarios con cron de purga reanudable (stepper + `forEachPage`)
- Dev: siembra usuarios de prueba (`defaults/devUsers.ts`); fuera de dev se purgan en cada arranque

Dependencias y configuración: `config.json` (env vars en `.env.example`).
