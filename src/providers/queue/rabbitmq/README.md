# RabbitMQ Provider

AMQP message broker provider with per-operation topology, retry queues with exponential backoff (TTL + DLX), and a shared dead-letter queue per service.

## Features

- Per-operation queues with dedicated retry levels
- Exponential backoff via TTL-based retry queues
- Typed 4xx errors (except 408/429) go straight to DLQ: retrying them never changes the outcome
- DLQ for terminal failures only
- Graceful shutdown with consumer drain
- Shared publisher with confirm mode

## Queue type

`RABBITMQ_QUEUE_TYPE` defaults to **`quorum`**, on one broker too: a quorum queue gains replicas hot
(`rabbitmq-queues grow <node> all`) when the broker is clustered, while a classic one has to be
deleted and redeclared. The retry queues stay classic on purpose — quorum queues don't support
queue-level `x-message-ttl`, which is the backoff mechanism. Changing the type of an existing queue
is impossible in place; the declare error says exactly which queue and how to drop it.
