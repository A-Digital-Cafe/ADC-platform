# OperationsService

Coordina **cuándo** corre el trabajo de la plataforma, no cómo se hace (`kernelMode: 45`).

## Features

- **`stepper(idx, cmd, id, steps)`** — Multi-step transactional pipeline with resume support. Tracks completed steps in MongoDB (TTL 48h). Supports saga steps with compensating revert methods.
- **`httpCheck(cmd, id, method)`** — Idempotency guard for HTTP operations. Prevents duplicate execution within a 2-minute window using Redis. Used automatically by EndpointManagerService for POST/PUT/PATCH/DELETE endpoints.
- **Trabajos de momentos ociosos** (`IIdleOrchestrator`) — barridos que nadie espera, en un turno compartido en vez de un `setInterval` por módulo. `parts/IdleJobs.ts` (gate por scope `idle:register` + config), `parts/IdleScheduler.ts` (turno, backoff, desalojo) y `parts/LoadSampler.ts` (¿proceso ocioso?). Ejemplo en [docs/architecture](../../../../docs/architecture/README.md#trabajos-de-momentos-ociosos-operationsservice).

## Dependencies

- `queue/redis` — Idempotency keys (2min TTL)
- `object/mongo` — Stepper state persistence (48h TTL index)
- Env de los trabajos ociosos (`IDLE_*`): `config.json` + `.env.example` de la raíz
