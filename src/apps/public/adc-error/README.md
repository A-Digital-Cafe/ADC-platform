# ADC Error

Microfront para mostrar páginas de error de la plataforma (OAuth, baneos, CSRF, fallback genérico).

## Rutas

- `/banned` — Cuenta o IP baneada (param: `reason`)
- `/csrf` — Error de validación CSRF en flujo OAuth
- `/oauth` — Error genérico de OAuth (params: `provider`, `message`)
- `/` — Fallback genérico (param: `message`)

## Detalles

- Puerto dev: 3026
- Subdominio: `error.adigitalcafe.com`
- Estética compartida con `adc-auth`
