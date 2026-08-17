# SessionManagerService

Autenticación OAuth 2.0 con Access/Refresh Tokens y rotación de secretos (`kernelMode: 70`).

## Endpoints (via @RegisterEndpoint)

| Método | Ruta                                        | Permisos            | Descripción                                                        |
| ------ | ------------------------------------------- | ------------------- | ------------------------------------------------------------------ |
| GET    | `/api/auth/login/:provider`                 | público             | Inicia login OAuth                                                 |
| GET    | `/api/auth/callback/:provider`              | público             | Callback OAuth                                                     |
| POST   | `/api/auth/login`                           | público             | Login nativo (username/password)                                   |
| POST   | `/api/auth/register`                        | público             | Alta (exige `legal`; el email se vincula por correo, ver abajo)    |
| GET    | `/api/auth/session`                         | público             | Verifica sesión                                                    |
| POST   | `/api/auth/refresh`                         | público             | Renueva tokens                                                     |
| GET    | `/api/auth/login/2fa`                       | público             | Estado del desafío de segundo factor pendiente (`verify`/`enroll`) |
| POST   | `/api/auth/login/2fa`                       | público             | Completa el login con un código (autenticador o recuperación)      |
| POST   | `/api/auth/login/2fa/enroll`                | público             | Alta obligatoria: entrega el secreto (sólo desafíos `enroll`)      |
| POST   | `/api/auth/login/2fa/enroll/confirm`        | público             | Confirma el alta, emite la sesión y entrega los códigos            |
| POST   | `/api/auth/logout`                          | público             | Cierra sesión                                                      |
| GET    | `/api/auth/legal/status`                    | sesión              | Documentos legales pendientes de re-aceptar (vacío = nada)         |
| POST   | `/api/auth/legal/accept`                    | sesión              | Acepta la versión vigente (constancia `via: "re-acceptance"`)      |
| GET    | `/api/auth/admin/users/:id/sessions`        | `security.sessions` | Lista sesiones activas del usuario (global-only, respeta jerarquía) |
| POST   | `/api/auth/admin/users/:id/sessions/revoke` | `security.sessions` | Force logout (revoca refresh tokens; respeta jerarquía de roles)   |

Usa `@EnableEndpoints()` y `@DisableEndpoints()` para registro automático via EndpointManagerService.
`exportUserData(cap, userId)` (scope `identity:internal`) aporta las sesiones activas —IP enmascarada, sin tokens— al export de datos de Identity.

## Providers soportados

- `discord` - OAuth con Discord
- `google` - OAuth con Google
- `platform` - Login nativo

## Variables de entorno

Ver `.env.example`: `JWT_SECRET` (mín. 32 chars, solo sin rotación de claves), `DISCORD_CLIENT_ID/SECRET`,
`GOOGLE_CLIENT_ID/SECRET`, `REDIS_*` (opcional, fallback en memoria) y overrides `SESSION_COOKIE_DOMAIN` /
`SESSION_DEFAULT_REDIRECT_URL` (vacío = default por entorno: localhost en dev, adigitalcafe.com en prod).

## Seguridad

- **Rotación de claves**: cada 24h, `SECRET_PREVIOUS = SECRET_CURRENT` y se genera nueva clave. Con varios
  nodos rota uno solo (lease `session.key-rotation` vía `OperationsService`) y los demás adoptan el par
  que quedó en Redis: rotando todos, el segundo dejaba fuera del par la clave recién emitida por el primero
- **Access Token**: JWT cifrado, 15 min, cookie `access_token`
- **Refresh Token**: opaco, 30 días, cookie HttpOnly en `/api/auth/refresh`; rotación de un solo uso con
  ventana de gracia de 60s (el token recién rotado devuelve el par vigente: pestañas de orígenes distintos
  no pueden coordinarse entre sí). `/api/auth/refresh` devuelve `expiresAt` para renovar antes de vencer
- **State OAuth**: el `state` (CSRF) vive en Redis con TTL nativo y se consume una sola vez (claim
  atómico `SET NX` sobre `oauth:state-consumed:`), porque el login y el callback del proveedor son
  requests distintos y con varios nodos no caen en el mismo proceso. Sin Redis usa memoria del
  proceso, que sólo alcanza para un despliegue de un nodo
- **Alta sin oráculo de email**: el registro crea la cuenta SIN email y delega la vinculación en
  `IdentityManager._internal(cap).bindEmailNeutrally` (fuera de banda). El 409 sólo existe para
  `USERNAME_EXISTS` (identidad pública, ya resoluble por HEAD); si el email está tomado, el aviso va
  a su titular y la respuesta —cuerpo y cookies— es idéntica a la del caso libre
- **Segundo factor**: entre "la contraseña es correcta" y "hay sesión". El desafío vive en Redis con
  su cookie HttpOnly (5 min, 5 intentos) y **no** reenvía la contraseña en el segundo paso, a
  diferencia del selector de organización. Aplica a quien ya lo activó y, obligatoriamente, a toda
  cuenta con rol Admin —de plataforma o de alguna organización—, que si no lo tiene lo da de alta ahí
  mismo o no entra. Cubre las tres vías: login nativo, callback OAuth y vinculación de cuenta; un
  fallo leyendo Identity responde 503 en vez de dejar pasar
- **Rate limiting**: 3 fallos login/día = bloqueo 1h; post-desbloqueo fallo = bloqueo permanente
- **Geo-validation**: cambio de país invalida sesión
- **Moderación**: integra `ModerationService` (opcional, vía `IModerationService`) para bloquear logins baneados;
  avisa `security.new_login` (inApp + email) ante login desde IP nueva
- **Aceptación legal**: el alta exige `legal` (aceptación de Términos/Privacidad + edad mínima) y
  rechaza con `LEGAL_VERSION_MISMATCH` si las versiones que manda el cliente no son las vigentes de
  `@common/utils/legal-docs`. La constancia (versiones + timestamp del servidor + vía) queda en
  `metadata.legalAcceptance`; el alta por OAuth graba la misma constancia con `via: "oauth"`
- **Cambios de documentos legales**: al detectar una versión nueva desplegada de CUALQUIER documento
  de `LEGAL_DOCUMENTS` (incluidos los informativos: cookies, DPA) anuncia el cambio a todas las
  personas usuarias (broadcast `platform.legal`, in-app no silenciable) y al equipo, con la fecha
  `effectiveFrom` desde la que rige. El chequeo corre a los 30s de cada arranque y en un solo nodo
  (lease `session.legal-version-check`), para que un deploy de N nodos no dispare N anuncios. Para
  terms/privacy, a partir de esa fecha `/api/auth/legal/status` marca el documento como pendiente y el
  componente `adc-legal-gate` pide la re-aceptación

## Proveedor OIDC

La plataforma como **emisor** de identidad (`/.well-known/openid-configuration`, `/api/oidc/*`).
Ojo con la dirección: `endpoints/oauth.ts` es la plataforma de *cliente* (entrar con Discord);
esto es al revés. Sólo authorization code + PKCE `S256`; los clientes se declaran en
`private.oidc.clients` y las URIs de retorno se comparan exactas. Firma RS256 con clave propia en
Redis (sellada) — el JWT de sesión es JWE simétrico y no sirve acá: un tercero tiene que poder
verificar sin poder emitir. Vacío `ADC_OIDC_ISSUER` = apagado y el descubrimiento responde 404.
