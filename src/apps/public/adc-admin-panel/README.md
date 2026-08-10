# adc-admin-panel

Panel de administración **general** de la plataforma (`admin.adigitalcafe.com`, dev `3046`).
Complementa a `adc-modules-manager`, que administra el runtime de los módulos.

- **Brechas** — registro e instrucción de incidentes de datos personales
  (`BreachRegisterService`): asistente por estados, reloj de 72 h, borradores de notificación y
  aviso a las personas afectadas. Permiso `security.breach`.
- **Auditoría** — lectura del audit log persistente (`security.audit_log`).
- **Planes** — catálogo, excepciones y ampliaciones (`plans.catalog` / `plans.overrides`).
  Migrado desde el gestor de módulos, que ya no lo incluye.
- **Drive** — moderación de contenido, cargada por Module Federation desde el preset `adc-drive`
  (`./ModerationPanel`). Si esa app está detenida, la tab no aparece. Permiso `drive.moderate`.

Todos los recursos son global-only: en contexto de organización el panel no muestra nada. El
gating real lo hace el backend; las capacidades del cliente sólo deciden qué se pinta.
Procedimiento de brechas: [docs/guides/breach-response.md](../../../../docs/guides/breach-response.md).
