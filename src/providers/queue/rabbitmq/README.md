# RabbitMQ Provider

AMQP message broker provider with per-operation topology, retry queues with exponential backoff (TTL + DLX), and a shared dead-letter queue per service.

## Features

- Per-operation queues with dedicated retry levels
- Exponential backoff via TTL-based retry queues
- Typed 4xx errors (except 408/429) go straight to DLQ: retrying them never changes the outcome
- DLQ for terminal failures only
- Graceful shutdown with consumer drain
- Shared publisher with confirm mode
