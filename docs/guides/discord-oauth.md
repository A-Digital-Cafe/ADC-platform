# Discord OAuth — Linked Accounts & Autoroles

## Flujo OAuth

1. **Login**: Usuario hace clic en "Iniciar sesión con Discord" → redirige a Discord OAuth con scopes `identify`, `email`, `guilds.members.read`
2. **Callback**: Discord redirige con código → se intercambia por tokens → se obtiene perfil del usuario
3. **Linked Account**: Se busca usuario por `linkedAccounts` (provider + providerId con status `"linked"`)
4. **Email match → Link Account**: Si el email de Discord coincide con un usuario existente, se redirige a `/auth/link-account` para que el usuario autentique con contraseña de plataforma antes de vincular (ver sección **Flujo de vinculación segura** abajo)
5. **Usuario nuevo**: Si no hay coincidencia, se crea un usuario nuevo. Si el username ya existe, se genera un sufijo aleatorio (`username_d{hex}`) para evitar colisiones
6. **Guild Roles**: Se llama a `GET /users/@me/guilds/{guildId}/member` con el access token para obtener los role IDs del usuario en el guild
7. **Role Sync**: Los Discord role IDs se traducen a roles de plataforma via `discordRoleMap` (config.json o DB), y se actualizan los `roleIds` del usuario
8. **Permisos**: Los permisos se resuelven automáticamente via `PermissionManager.resolvePermissions()` basándose en los `roleIds`

## Flujo de vinculación segura (Link Account)

Cuando el email de Discord coincide con un usuario existente de la plataforma, **no** se vincula automáticamente. En su lugar:

1. El callback genera un **token opaco** (32 bytes random) y almacena los datos de Discord **server-side** en memoria
2. El token opaco se envía como cookie httpOnly (`oauth_pending_link`, TTL 5 min)
3. Se redirige a `/auth/link-account?provider=discord&email=...` donde el frontend muestra un formulario de contraseña
4. El usuario envía su contraseña de plataforma → `POST /api/auth/link-account` con `{ password }`
5. El backend verifica la contraseña, vincula la cuenta, sincroniza roles de Discord, y emite tokens de sesión

### Seguridad del endpoint link-account

- **Datos server-side**: El access token de Discord y los datos de vinculación **nunca** se envían al cliente — la cookie solo contiene un token opaco que referencia datos en el servidor
- **Redis con fallback**: Los pending links se almacenan en Redis (con TTL nativo de 5 min) para soporte de clústeres. Sin Redis, se usa un Map en memoria con limpieza periódica
- **One-time use**: El token se consume al vincular exitosamente
- **Rate-limiting**: Máximo 3 intentos de contraseña por token; al excederlos el token se invalida y el usuario debe reiniciar el flujo OAuth
- **TTL estricto**: Los pending links expiran automáticamente después de 5 minutos (TTL nativo en Redis)
- **Open redirect protection**: `returnUrl` se valida contra whitelist de dominios permitidos (`adigitalcafe.com` y subdominios, `localhost`). URLs externas se ignoran silenciosamente

### Protección contra colisión de usernames

Si el username de Discord ya existe en la plataforma al crear un usuario nuevo, se genera un sufijo aleatorio:

```
username → username_d3a7f2b (6 hex chars)
```

Se reintenta hasta 5 veces con sufijos random. Fallback extremo: `username_d{timestamp_base36}`.

## Mapeo de Roles Discord → Plataforma

La configuración de mapeo vive en dos niveles:

### Config por defecto (config.json de IdentityManagerService)

```json
{
	"private": {
		"discordGuildId": "${DISCORD_GUILD_ID}",
		"discordRoleMap": {
			"<discord_role_id>": "Discord VIP",
			"<discord_role_id>": "Discord Nitro Booster"
		}
	}
}
```

### Config por guild en DB (para organizaciones)

Colección `DiscordGuildConfig` con esquema:

- `guildId`: ID del guild de Discord
- `roleMap`: `Record<string, string>` — Discord Role ID → nombre de rol de plataforma
- `orgId`: Organización asociada (null = global)

### Roles Community predefinidos

| Rol                       | Recurso                         | Permisos                                          |
| ------------------------- | ------------------------------- | ------------------------------------------------- |
| **Discord VIP**           | `community`, `community.social` | Leer community + Escribir en social (comentarios) |
| **Discord Nitro Booster** | `community`, `community.social` | Leer community + Escribir en social (comentarios) |
| **Discord Publisher**     | `community`                     | Leer + Escribir/Actualizar contenido              |
| **Discord Reviewer**      | `community`                     | CRUD contenido + Actualizar PUBLISH_STATUS        |

> **Nota**: Publisher y Reviewer se asignan manualmente, no se mapean automáticamente por rol de Discord.

## Leer autoroles desde microfrontends

Los permisos llegan serializados en la sesión como strings `"resource.scope.action"`:

```typescript
import { authApi } from "@adc-auth/utils/auth";

const session = await authApi.getSession();
const permissions = session.user?.permissions || [];
```

### Verificar si un usuario puede comentar (VIP/NitroBooster)

```typescript
// Los permisos community.social con acción WRITE (2) indican que puede comentar
const canComment = permissions.some((p) => {
	const [resource, scope, action] = p.split(".");
	return resource === "community.social" && (Number(action) & 2) !== 0; // WRITE = 2
});
```

### Verificar por roleIds directamente

```typescript
// Si se conocen los IDs de los roles Discord
const discordRoleIds = ["<vip_role_id>", "<booster_role_id>"];
const hasDiscordRole = session.user?.roleIds?.some((id) => discordRoleIds.includes(id));
```

### Verificar linked accounts

```typescript
// Verificar si el usuario tiene Discord vinculado
const hasDiscord = session.user?.linkedAccounts?.some((la) => la.provider === "discord" && la.status === "linked");
```

## Vinculación/Desvinculación desde Frontend

- **Vincular**: Redirigir a `/api/auth/login/discord`. Si el email de Discord coincide con un usuario existente, será redirigido a `/auth/link-account` para autenticarse con contraseña antes de vincular
- **Desvincular**: Llamar al endpoint de gestión de cuenta que invoca `unlinkExternalAccount(userId, "discord")`. El registro queda con status `"unlinked"` (no se elimina)
- **Anti-colisión**: Si un Discord ID ya está vinculado a otro usuario con status `"linked"`, se retorna error explicativo

## Endpoints

| Método | URL                            | Descripción                                                      |
| ------ | ------------------------------ | ---------------------------------------------------------------- |
| GET    | `/api/auth/login/:provider`    | Inicia flujo OAuth (redirige a Discord)                          |
| GET    | `/api/auth/callback/:provider` | Callback OAuth (procesa código, crea/vincula usuario)            |
| POST   | `/api/auth/link-account`       | Vincula cuenta OAuth con usuario existente (requiere contraseña) |

## Notas técnicas

- Los tokens de Discord **no se persisten** — solo se usan durante el callback para obtener guild roles
- La sincronización de roles es **solo on-login** — no hay refresh periódico
- Si la API de Discord retorna 429 (rate limit), se omite la sincronización de roles silenciosamente
- Los roles mapeados que el usuario ya no tiene en Discord se remueven automáticamente en el siguiente login
- Roles asignados manualmente (no presentes en el `discordRoleMap`) no se tocan durante la sincronización
