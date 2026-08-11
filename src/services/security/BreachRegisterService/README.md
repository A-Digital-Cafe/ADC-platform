# BreachRegisterService

Registro e instrucción de incidentes que afectan datos personales (art. 33.5 RGPD;
Res. AAIP 47/2018). Es el respaldo de lo que promete `/privacy` §11. Colección Mongo
`breach_incidents` + `breach_affected` (db `adc-breach`), con **TTL de 5 años desde el cierre**
(`BREACH_RETENTION_DAYS`, art. 2560 CCyC): el registro es la prueba de que la decisión de notificar
—o de no hacerlo— fue correcta, y un incidente abierto no caduca nunca porque el TTL cuelga de
`closedAt`.

- **Instrucción**: `detected → assessing → contained → registered → authority_notified →
  subjects_notified → closed`, con salida a `no_notification`. Cada paso exige los campos sin los
  cuales el siguiente sería indefendible; notificar (autoridad o personas) y decidir no notificar
  son **fail-closed**: sin auditoría disponible no se aplican (503).
- **Reloj de 72 h**: `authorityDeadlineAt` se calcula al abrir; un trabajo ocioso avisa al equipo
  (topic `breach.alert`, con referencia y plazo) una vez antes de que venza y otra cuando venció.
- **Aviso a las personas**: `notifySegment` sobre `platform.security_incident` (canal insilenciable),
  con la audiencia congelada antes de enviar. Sólo se asienta `sent` quien recibió; a quien falló lo
  vuelve a tomar el reintento, que no duplica (dedup por `broadcastId`).
- **Plantillas**: borradores de la notificación a la autoridad (art. 33.3), del aviso a las
  personas (los seis puntos de §11) y de la comunicación pública (art. 34.3.c).
- **API**: `/api/security/breaches[...]`, permiso `security.breach` (global-only); la máquina de
  estados exige EXECUTE. Panel: `adc-admin-panel`. Runbook: `docs/guides/breach-response.md`.
