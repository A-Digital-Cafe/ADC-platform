# Servicios — índice práctico (crear y editar)

Guía rápida para trabajar sobre la capa de servicios. Para **crear uno nuevo** seguí el
orden de lectura; para **editar/extender** uno existente o agregarle un feature, usá la
tabla "quiero X → toco Y" y los patrones transversales. No dupliques acá lo que ya
explican los cuatro docs de capa.

## Crear un servicio nuevo (orden de lectura)

1. [models.md](models.md) — tipos de dominio y schemas Mongoose.
2. [daos.md](daos.md) — capa de acceso, autorización y reglas de negocio.
3. [endpoints.md](endpoints.md) — capa HTTP (adaptadores `@RegisterEndpoint`).
4. [service-shell.md](service-shell.md) — ensamblaje: `index.ts`, `config.json`, `start()`.

> Scaffolding: `bun run create:service -- mi-servicio` (igual hay que leer la doc de cada capa).

## Editar / extender un servicio o agregar un feature

| Quiero…                                             | Toco…                                                                 |
| --------------------------------------------------- | --------------------------------------------------------------------- |
| Campo nuevo en una entidad / colección nueva        | `domain/` + tipo en `@common/types/<dominio>/` → [models.md](models.md) |
| Regla de negocio, filtro, permiso, paginación       | `dao/` (manager del recurso) → [daos.md](daos.md)                     |
| Ruta HTTP nueva (CRUD u operación)                  | `endpoints/` + schema TypeBox en `endpoints/schemas/` → [endpoints.md](endpoints.md) |
| Dependencia nueva (provider/utility/servicio)       | `config.json` + getter en `start()` → [service-shell.md](service-shell.md) |
| Error tipado nuevo                                  | `@common/types/custom-errors/<Servicio>Error.ts` (extiende `ADCCustomError`) |
| Que otros módulos consuman el servicio              | Interfaz en `@common/types/<dominio>/I<Servicio>.ts` (no la clase concreta) |

Reglas al editar: respetá el flujo `super.start()` → providers → servicios → models →
managers → endpoints; exponé managers con getters defensivos (nunca los models); validá
con `bun run typecheck`/`bun run lint` (lint solo cubre `src/`; un preset se valida con
`npx tsgo -p presets/<preset>/tsconfig.json --noEmit`); README del módulo ≤ 15 líneas.

## Patrones transversales

### 1. Dependencia opcional (degradación limpia)

Una capacidad secundaria que puede faltar (cola, attachments, otro servicio) degrada: el
servicio arranca igual y solo fallan los endpoints relacionados (getter que lanza `503`
tipado). Para depender de **otro servicio** opcional, declaralo en `config.json` y resolvelo
con `tryGetMyService` (devuelve `undefined` si no está cargado, sin lanzar):

```ts
const email = this.tryGetMyService<INotificationEmailSender>("EmailService");
if (email && typeof email.sendSystemEmail === "function") await email.sendSystemEmail(/* … */);
```

> Declarar la dep como `{ "name": "EmailService", "optional": true }` en `config.json` para
> que el arranque no falle si el preset no está — `getMyService`/`tryGetMyService` **solo
> resuelven dependencias declaradas** (ver [kernel-access.md](../kernel-access.md)). Tipar
> contra una **interfaz de `@common`**, nunca contra la clase concreta del preset.

### 2. Endpoint SSE / streaming (long-lived)

`@RegisterEndpoint` bufferiza la respuesta: **no** sirve para SSE. Registrá la ruta directo
sobre el http provider y escribí en el socket crudo. ⚠️ En Bun, `reply.send(Readable)` tras
un fetch saliente puede dar 0 bytes: por eso se usa `reply.hijack()` + `reply.raw`, no `send`.

```ts
const http = this.getMyProvider<IHostBasedHttpProvider>("fastify-server");
http.registerRoute("GET", "/api/mi-servicio/stream", (req, reply) => {
	// autenticar con ISessionVerifier (cookie de sesión), luego:
	reply.hijack();
	reply.raw.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
	reply.raw.write(`data: ${JSON.stringify(evento)}\n\n`);
	req.raw.on("close", cleanup);
});
```

Referencia real: `presets/adc-notifications/services/NotificationService/sse/`.

### 3. Integración por eventos (emitir notificaciones)

Para avisar al usuario de algo (compartición, mención, job listo…), usá
`this.emitNotification(...)` heredado de `BaseModule` (lo tienen todos los módulos).
Es **desacoplado y tolerante a fallos**: encola en RabbitMQ durable (preferido) →
entrega directa si no hay cola → descarta best-effort si no hay subsistema. **Nunca
lanza** ni requiere declarar `NotificationService`/`queue/rabbitmq` como dependencia:

```ts
await this.emitNotification({
	userId,
	topic: "drive.shared", // <app>.<evento>
	title,
	body,
	linkApp: "drive", // app de plataforma → el cliente resuelve `link` a puerto (dev) / subdominio (prod)
	link: "/shared", // ruta dentro de la app (o URL absoluta si se omite `linkApp`)
});
```

> `linkApp` + `link` evita hardcodear orígenes; `channels` fuerza canales (p. ej.
> `["inApp", "email"]` para seguridad) y `collapseUnread: true` colapsa eventos
> recurrentes (correo entrante) en una sola entrada hasta que se lea. El tipo `NotifyInput`
> y el contrato `INotificationService` viven en `@common/types/notifications/` — dependé de
> ellos, nunca de la clase concreta del preset.

## Checklist de edición

- [ ] Cambios alineados a la capa correcta (models/daos/endpoints/shell).
- [ ] Deps nuevas declaradas en `config.json`; env vars sin `process.env`, en `.env.example`.
- [ ] Capacidades opcionales con `hasModule()`/`try-catch` y `503` tipado.
- [ ] Streaming con `reply.hijack()` + `reply.raw` (nunca `reply.send(Readable)`).
- [ ] Contratos hacia afuera vía interfaz en `@common/types`, no la clase concreta.
- [ ] `typecheck` + `lint` (o `tsgo --noEmit` del preset) en verde; README del módulo actualizado.
