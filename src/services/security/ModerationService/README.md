# ModerationService

Lista anti-evasión basada en hashes (HMAC-SHA256) de emails normalizados y de IPs recientes.

- Mongo para persistencia (colección `bans`) con índices multikey en `emailHashes` y `ipHashes`.
- Redis para lookups O(1) (`SISMEMBER`) en caliente; warmup al arrancar.
- Buffer Redis por usuario con las IPs hasheadas de los últimos 3h (TTL automático).
- Sync con `pengubot.modlogs` (type=Ban, hiddenCase) al arrancar y diariamente.

Pepper para los hashes: `BAN_HASH_PEPPER` (env). No se guarda PII en ningún registro.

Permisos: solo admin global vía endpoints `/api/moderation/bans/*`.
