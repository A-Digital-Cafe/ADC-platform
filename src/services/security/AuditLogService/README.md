# AuditLogService

Registro persistente y **append-only** de acciones administrativas sobre datos personales
(accountability art. 5.2 RGPD / art. 9 Ley 25.326). Colección Mongo `audit_log` (db `adc-audit`)
con TTL configurable sobre `at` (`AUDIT_LOG_RETENTION_DAYS`, 730 días por defecto).

- **Escribir** (otros módulos): declarar `privileges: ["audit:write"]` + `AuditLogService` en
  `services` del `config.json` y llamar `record(cap, entry)` (best-effort) o `recordStrict(cap, entry)`
  (fail-closed, lanza `AuditError`); `isWritable()` es el pre-flight para abortar antes de mutar.
  El `origin` de cada entrada sale del owner de la capability (no falsificable).
- **Leer**: `GET /api/security/audit-log` (permiso `security.audit_log`, global-only),
  paginado por cursor `(at, id)` con filtros por action/actor/target.
- `context` se sanea al escribir: solo primitivos (IDs, contadores); emails/IPs se descartan.

Primer productor: recuperación admin de Drive (`drive.recover-deleted`, fail-closed).
