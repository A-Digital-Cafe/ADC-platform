# SessionManagerService

Autenticación OAuth 2.0 con Access/Refresh Tokens y rotación de secretos (`kernelMode: 70`).

## Endpoints (via @RegisterEndpoint)

| Método | Ruta                                        | Permisos            | Descripción                                                        |
| ------ | ------------------------------------------- | ------------------- | ------------------------------------------------------------------ |
| GET    | `/api/auth/login/:provider`                 | público             | Inicia login OAuth                                                 |
| GET    | `/api/auth/callback/:provider`              | público             | Callback OAuth                                                     |
| POST   | `/api/auth/login`                           | público             | Login nativo (username/password)                                   |
| POST   | `/api/auth/register`                        | público             | Registro de nuevo usuario                                          |
| GET    | `/api/auth/session`                         | público             | Verifica sesión                                                    |
| POST   | `/api/auth/refresh`                         | público             | Renueva tokens                                                     |
| POST   | `/api/auth/logout`                          | público             | Cierra sesión                                                      |
| GET    | `/api/auth/admin/users/:id/sessions`        | `security.sessions` | Lista sesiones activas del usuario (global-only, respeta jerarquía) |
| POST   | `/api/auth/admin/users/:id/sessions/revoke` | `security.sessions` | Force logout (revoca refresh tokens; respeta jerarquía de roles)   |

Usa `@EnableEndpoints()` y `@DisableEndpoints()` para registro automático via EndpointManagerService.

## Providers soportados

- `discord` - OAuth con Discord
- `google` - OAuth con Google
- `platform` - Login nativo

## Variables de entorno

Ver `.env.example`: `JWT_SECRET` (mín. 32 chars, solo sin rotación de claves), `DISCORD_CLIENT_ID/SECRET`,
`GOOGLE_CLIENT_ID/SECRET`, `REDIS_*` (opcional, fallback en memoria) y overrides `SESSION_COOKIE_DOMAIN` /
`SESSION_DEFAULT_REDIRECT_URL` (vacío = default por entorno: localhost en dev, adigitalcafe.com en prod).

## Seguridad

- **Rotación de claves**: cada 24h, `SECRET_PREVIOUS = SECRET_CURRENT` y se genera nueva clave
- **Access Token**: JWT cifrado, 15 min, cookie `access_token`
- **Refresh Token**: opaco, 30 días, cookie HttpOnly en `/api/auth/refresh`
- **Rate limiting**: 3 fallos login/día = bloqueo 1h; post-desbloqueo fallo = bloqueo permanente
- **Geo-validation**: cambio de país invalida sesión
- **Moderación**: integra `ModerationService` (opcional, vía `IModerationService`) para bloquear logins baneados;
  avisa `security.new_login` (inApp + email) ante login desde IP nueva
