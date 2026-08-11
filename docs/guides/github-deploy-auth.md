# Autorización GitHub para deploys y clones (device flow)

Los deploys del gestor de módulos y los clones de presets del `postinstall` piden una
**autorización humana por device flow de GitHub** en vez de usar credenciales residentes.
Propiedad de seguridad: en el servidor **no hay nada que robar** — ni PAT, ni SSH key
dedicada, ni private key de App, ni refresh token (se descarta adrede). El token de acceso
(`ghu_…`) vive **sólo en memoria** hasta `ADC_GITHUB_TOKEN_TTL_MINUTES` (default 60) o el
vencimiento que imponga GitHub, lo que llegue primero.

## Crear la GitHub App (una sola vez)

1. En la organización: **Settings → Developer settings → GitHub Apps → New GitHub App**.
2. Nombre libre; Homepage URL cualquiera válida. **Callback URL: no hace falta.**
3. Marcar **Enable Device Flow** (imprescindible).
4. **Webhook: Off.**
5. Permissions → Repository → **Contents: Read-only**. Nada más.
6. Recomendado: en la App, **User authorization token expiration: activado** (tokens de 8 h).
7. Crear, e **instalar la App en la organización** (Install App) seleccionando los repos de
   presets + el repo core. **No** generar ni guardar private key: este flujo no la usa.
8. Copiar el **Client ID** (identificador público, no es secreto) al `.env`:
   `ADC_GITHUB_CLIENT_ID=Iv1.xxxxxxxx`.

> El token resultante es la **intersección** de los permisos de la App y los de quien
> autoriza: sólo sirve si esa persona tiene acceso a los repos. Contents read-only alcanza
> para `fetch`/`clone`; la App no puede escribir aunque quien autorice sí pueda.

## Cómo se usa

- **Panel** (`adc-modules-manager` → tab Git): card "Autorización GitHub" → *Autorizar
  GitHub* → ingresar el código en `github.com/login/device`. Con el flujo configurado,
  **ningún deploy** (pull, rollback, unpin, con o sin mantenimiento) corre sin token
  vigente (`428 GITHUB_AUTH_REQUIRED`). Un **update programado** que vence sin token no
  falla: queda pendiente, avisa por notificación y corre apenas alguien autorice. *Revocar*
  descarta el token en memoria. Todo queda auditado (`git-auth`).
- **Postinstall** (`bun install` → `scripts/sync-presets.mjs`): si un preset no se puede
  leer anónimamente y hay TTY, imprime el código en consola y espera la autorización (una
  vez por corrida). Sin TTY o sin Client ID, se mantiene el skip silencioso de siempre.

El token se pasa a `git` por el **env del subproceso** (`http.https://github.com/.extraheader`),
nunca por argv ni disco; los remotes quedan `https://` sin credenciales.
