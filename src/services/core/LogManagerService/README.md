# LogManagerService

Dueño de los logs de la plataforma. `kernelMode: 55` (después de `EndpointManagerService`, que necesita para registrar su ruta).

- **Consulta del proceso**: `GET /api/logs?level=&module=&q=&limit=&cursor=` sobre el ring buffer en memoria. Permiso `modules.logs` (bit propio: los logs arrastran datos de cualquier dominio) + contexto global.
- **El buffer NO vive acá**, sino en `@common/utils/log-buffer.ts`, y es a propósito: tiene que existir desde el `import` para capturar el arranque del kernel y de los servicios `kernelMode`. Este servicio es dueño de la **lectura**; el único que escribe es `ConsoleLogger`.
- **Redacción al escribir** (`@common/utils/redact.ts`): si se redactara al leer, el buffer sería un almacén consultable de secretos. La consola conserva fidelidad total.
- **Efímero y parcial**: no hay persistencia (se pierde al reiniciar) y no incluye lo que loguean los `worker_threads`, que tienen su propia copia del logger.
- **Archivos en disco**: rota y limpia `temp/logs/**` (lo que escriben los dev-servers de UI) por antigüedad y cantidad — `custom.retentionDays` / `retentionCount`. Esos archivos hoy sólo se rotan, no se consultan por HTTP.
