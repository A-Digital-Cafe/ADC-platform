# SessionManagerService

Autenticación OAuth 2.0 con Access/Refresh Tokens y rotación de secretos (`kernelMode: 70`).

## Endpoints (via @RegisterEndpoint)

| Método | Ruta                                        | Permisos            | Descripción                                                        |
| ------ | ------------------------------------------- | ------------------- | ------------------------------------------------------------------ |
| GET    | `/api/auth/login/:provider`                 | público             | Inicia login OAuth                                                 |
| GET    | `/api/auth/callback/:provider`              | público             | Callback OAuth                                                     |
| POST   | `/api/auth/login`                           | público             | Login nativo (username/password)                                   |
| POST   | `/api/auth/register`                        | público             | Registro de nuevo usuario (exige `legal`: ver abajo)               |
| GET    | `/api/auth/session`                         | público             | Verifica sesión                                                    |
| POST   | `/api/auth/refresh`                         | público             | Renueva tokens                                                     |
| POST   | `/api/auth/logout`                          | público             | Cierra sesión                                                      |
| GET    | `/api/auth/legal/status`                    | sesión              | Documentos legales pendientes de re-aceptar (vacío = nada)         |
| POST   | `/api/auth/legal/accept`                    | sesión              | Acepta la versión vigente (constancia `via: "re-acceptance"`)      |
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
- **Refresh Token**: opaco, 30 días, cookie HttpOnly en `/api/auth/refresh`; rotación de un solo uso con
  ventana de gracia de 60s (el token recién rotado devuelve el par vigente: pestañas de orígenes distintos
  no pueden coordinarse entre sí). `/api/auth/refresh` devuelve `expiresAt` para renovar antes de vencer
- **Rate limiting**: 3 fallos login/día = bloqueo 1h; post-desbloqueo fallo = bloqueo permanente
- **Geo-validation**: cambio de país invalida sesión
- **Moderación**: integra `ModerationService` (opcional, vía `IModerationService`) para bloquear logins baneados;
  avisa `security.new_login` (inApp + email) ante login desde IP nueva
- **Aceptación legal**: el alta exige `legal` (aceptación de Términos/Privacidad + edad mínima) y
  rechaza con `LEGAL_VERSION_MISMATCH` si las versiones que manda el cliente no son las vigentes de
  `@common/utils/legal-docs`. La constancia (versiones + timestamp del servidor + vía) queda en
  `metadata.legalAcceptance`; el alta por OAuth graba la misma constancia con `via: "oauth"`
- **Cambios de documentos legales**: al detectar una versión nueva desplegada anuncia el cambio a
  todas las personas usuarias (broadcast `platform.legal`, in-app no silenciable) y al equipo, con la
  fecha `effectiveFrom` desde la que rige. A partir de esa fecha `/api/auth/legal/status` marca el
  documento como pendiente y el componente `adc-legal-gate` pide la re-aceptación
