# ModerationService

Lista anti-evasión basada en hashes (HMAC-SHA256) de emails normalizados y de IPs recientes.

- Mongo para persistencia (colección `bans`) con índices multikey en `emailHashes` y `ipHashes`.
- Redis para lookups O(1) (`SISMEMBER`) en caliente; warmup al arrancar.
- Buffer Redis por usuario con las IPs hasheadas de los últimos 3h (TTL automático).
- Sync con `pengubot.modlogs` (type=Ban, hiddenCase) al arrancar y diariamente.

Pepper para los hashes: `BAN_HASH_PEPPER` (env). Al levantarse o vencer un ban se borran
`emailMasks`, `lastLoginAt` y `reason`; el TTL de Mongo sobre `unbannedAt` borra el registro a los
`BAN_RETENTION_DAYS` (180 por defecto).

Barrido de vencidos cada 6 h: desactiva y minimiza las filas **y reactiva la cuenta** en Identity
(si no, un ban temporal bloqueaba el login hasta un unban manual). Sólo reactiva cuando la cuenta
sigue inactiva por ESE ban: con una baja programada pendiente no la toca, porque el unban limpiaría
esa baja y resucitaría la cuenta.

Permisos: solo admin global vía endpoints `/api/moderation/bans/*`.
