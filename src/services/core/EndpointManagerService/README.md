# EndpointManagerService

Este servicio es el núcleo de la gestión de endpoints HTTP de la plataforma. Centraliza el registro de rutas, la validación de permisos y el manejo de solicitudes, actuando como un orquestador entre los servicios de negocio y el proveedor del servidor HTTP.

## Flujo de Trabajo y Características

El flujo de trabajo se basa en un sistema declarativo mediante decoradores, lo que simplifica la creación de APIs seguras y consistentes.

### 1. Registro Declarativo de Endpoints

Los endpoints se definen directamente en los métodos de un servicio utilizando el decorador `@RegisterEndpoint`. Esto mantiene la lógica del endpoint y su configuración en el mismo lugar.

```typescript
import { EnableEndpoints, DisableEndpoints, RegisterEndpoint, EndpointCtx } from "./EndpointManagerService/index.js";
import * as S from "./endpoints/schemas/data.js"; // schemas TypeBox en carpeta aparte

class MyDataService extends BaseService {
	@RegisterEndpoint({
		method: "GET",
		url: "/api/data/:id",
		permissions: ["data.read"], // Permisos requeridos
		options: {
			// Agrupa el endpoint en Swagger UI como sub-tag "MyDataService/Data".
			tag: "MyDataService/Data",
			summary: "Obtiene un registro por ID",
			description: "Devuelve el registro identificado por `id`.",
			// Validación declarativa con TypeBox: 400 automático si la entrada no cumple.
			// Los schemas también alimentan el doc OpenAPI servido en /api/docs (Swagger UI).
			// `response` es solo documentación (no se valida en runtime).
			schema: { params: S.DataIdParams, response: { 200: S.DataResponse } },
		},
	})
	async getData(ctx: EndpointCtx<{ id: string }>) {
		// La validación de permisos y el contexto ya están resueltos.
		// ctx.user contiene la info del usuario si el endpoint es protegido.
		const { id } = ctx.params;
		return { message: `Data for ID: ${id}` };
	}

	// ... ciclo de vida del servicio
}
```

Notas de seguridad/operación:

- `requireAuth: true` exige sesión válida (401 sin usuario) sin chequear permisos finos — preferirlo sobre `deferAuth` cuando el endpoint nunca debe ejecutarse anónimo (el DAO autoriza por scope).
- Los endpoints públicos (`permissions: []`) SIEMPRE reciben rate limit por defecto: el kill-switch `ENDPOINT_RATE_LIMIT_ENABLED` no los afecta.
- Las denegaciones 401/403 se auditan en logs (`[AUTHZ-DENY] …`), y los errores 500 responden con `correlationId` (detalle solo en logs del servidor).
- Swagger UI: `/api/docs` (activo en dev; en producción requiere `API_DOCS_ENABLED=true`).

#### Documentación OpenAPI (Swagger UI)

`options` admite campos de documentación que alimentan `/api/docs`:

- **`tag`**: sub-tag plano con convención `"Servicio/Recurso"` (ej. `"IdentityManagerService/Users"`). Los sub-tags que comparten prefijo se agrupan y ordenan juntos en Swagger UI. Si se omite, se usa el nombre del servicio.
- **`summary`** / **`description`**: título de una línea y descripción larga (markdown) del endpoint.
- **`deprecated`**: marca el endpoint como obsoleto.
- **`schema.response`**: schemas TypeBox de respuesta por código (`{ 200: ..., 404: ... }`). Solo documentación: NO se validan en runtime (a diferencia de `body`/`querystring`/`params`).

> Convención: los schemas TypeBox viven en una carpeta aparte `endpoints/schemas/<dominio>.ts` (un módulo por dominio) para no inflar los archivos de endpoints. Se importan con extensión `.js` (ESM).

### 2. Ciclo de Vida Automático

El registro y desregistro de los endpoints está ligado al ciclo de vida del servicio que los contiene.

- **`@EnableEndpoints()`**: Usado en el método `start()` de un servicio, le indica al `EndpointManagerService` que registre todos los endpoints decorados en ese servicio.
- **`@DisableEndpoints()`**: Usado en el método `stop()`, limpia automáticamente todos los endpoints de ese servicio.

### 3. Gestión de Seguridad y Permisos

La seguridad es una responsabilidad compartida entre `EndpointManagerService` y `SessionManagerService`, cada uno con un rol bien definido. El proceso se desencadena de forma transparente gracias a los decoradores.

#### El Flujo de Validación de una Petición

1.  **Wrapper y Extracción de Token**: Cada petición a un endpoint es interceptada por un "wrapper" lógico. Lo primero que hace es buscar un token de usuario en la cookie de sesión y, si no hay, en `Authorization: Bearer`. **No se acepta por query string** (una URL queda en logs de proxy, historial y `Referer`); los consumidores que no pueden poner headers (`EventSource`, `<img>`, descargas) usan la cookie same-origin.

2.  **Consulta al `SessionManagerService` (El Portero)**: `EndpointManagerService` le pasa el token encontrado al `SessionManagerService` con una pregunta simple: **"¿Es este token auténtico y a quién pertenece?"**.
    - `SessionManagerService` valida la firma y la fecha de expiración del token.
    - Si es válido, responde con la identidad del usuario y la lista completa de **permisos que tiene asignados**.

3.  **Validación en `EndpointManagerService` (El Control de Acceso)**: Con la identidad y los permisos del usuario en mano, `EndpointManagerService` realiza la validación final. Compara la lista de permisos del usuario con los `permissions` requeridos en el decorador `@RegisterEndpoint` para esa ruta específica.
    - Aquí se aplica la lógica granular que soporta wildcards (`*`) y comprobaciones a nivel de bit.
    - Solo si el usuario cumple con los requisitos, se procede. Si no, la petición se rechaza con un error 403.

4.  **Inyección de Contexto (`EndpointCtx`)**: Tras una validación exitosa, se enriquece la petición con un objeto `EndpointCtx` que se pasa al método del endpoint. Este objeto contiene datos de la petición (`params`, `body`, etc.) y, crucialmente, el objeto `user` con la información del usuario autenticado.

En resumen, la colaboración es la siguiente:

- **`SessionManagerService`**: Valida la **autenticidad** de un token y **quién** es el usuario.
- **`EndpointManagerService`**: Valida la **autorización**, es decir, si ese usuario tiene acceso a **este recurso en particular**.

#### CSRF e Idempotencia

- Las mutaciones con autenticación por cookie validan `X-CSRF-Token` contra la cookie HttpOnly `adc_csrf`.
- `GET /api/csrf-token` emite el token firmado y `adc-fetch.ts` lo adjunta automáticamente.
- Hay rate limit Redis por defecto; `options.rateLimit` permite endurecer endpoints sensibles.
- POST/PUT/PATCH/DELETE exigen `Idempotency-Key` salvo `skipIdempotency`.
- `skipCsrf` queda reservado para endpoints que no dependan de cookies del navegador.

### 4. Manejo Avanzado de Respuestas

El servicio envuelve cada endpoint para estandarizar el manejo de respuestas y errores. Para casos complejos, se pueden lanzar excepciones especiales:

#### Errores de Negocio (`HttpError`)

Para devolver un error HTTP específico (ej: 404, 400) de forma controlada.

```typescript
import { HttpError } from "@common/types/ADCCustomError.js";

if (!userExists) {
	throw new HttpError(404, "NOT_FOUND", "User does not exist");
}
```

#### Respuestas Especiales (`UncommonResponse`)

Para situaciones que requieren más que un simple JSON, como redirects o manejo de cookies.

```typescript
import { UncommonResponse } from "./EndpointManagerService/index.js";

// Hacer un redirect y establecer una cookie (ej: tras un login OAuth)
throw UncommonResponse.redirect("/dashboard", {
	cookies: [{ name: "session_token", value: jwt, options: { httpOnly: true } }],
});
```

### 5. Comunicación Segura Inter-Servicios (`callService`)

`callService` es un mecanismo de optimización para la comunicación interna entre servicios. En lugar de que un servicio `A` haga una llamada HTTP a un endpoint del servicio `B` (lo cual es lento), `callService` permite una llamada de función directa y segura.

**¿Cómo funciona?**
Un servicio `A` puede invocar un método de un servicio `B` pidiéndoselo al `EndpointManagerService`. `EndpointManagerService` primero realiza la misma validación de permisos que haría para un endpoint HTTP, usando el token del llamante. Si la validación es exitosa, busca la instancia del servicio `B` en el kernel y ejecuta el método directamente, sin pasar por la capa de red.

Esto ofrece la **seguridad** de una llamada a un endpoint con la **velocidad** de una llamada de función local.

### 6. Métricas por Endpoint

Ventana **móvil de 24 h**, no un día calendario: así a las 00:05 se sigue viendo la tarde anterior en vez de una tabla vacía. Tres soportes para los mismos contadores (`parts/metrics-aggregate.ts` define la forma y la suma):

1. **Memoria** (`parts/metrics.ts`): el hot path sólo suma en memoria por clave `"<METHOD> <url>"` — `count`, latencia (media/p90/pico), bytes y errores **por código HTTP**. El p90 sale de un histograma de clases logarítmicas, no de guardar cada muestra: el error queda acotado por el ancho de la clase.
2. **Redis** (`epm:<YYYY-MM-DDTHH>`): un flush periódico vuelca el delta de la **hora en curso**. Es la red de contención ante un hot-reload o un reinicio dentro de la misma hora.
3. **Mongo** (`parts/metrics-store.ts`, db `adc-endpoints`): al cerrar cada hora, su hash se archiva como una fila por (hora, endpoint), se borra de Redis y se poda lo que quedó fuera de la retención. Se archiva **siempre** una marca de "hora medida", incluso sin tráfico: sin ella una hora tranquila sería indistinguible de una hora caída y la media por hora saldría siempre de más.

`getEndpointMetrics()` suma el archivo + el hash de la hora en curso + el delta que el hot path todavía no volcó (así una tanda de 500 se ve en el acto, no un minuto después). `perHour` promedia **sólo horas cerradas**; la hora en curso se informa aparte (`currentCount`) y suma a los totales. `hourly` viene alineado con `hours` para dibujar la serie por hora. `resetEndpointMetrics(key?)` borra los tres soportes: limpiar sólo la memoria dejaría 24 h de historia y la tabla no se movería. Ambos implementan `IEndpointMetricsReader` de `@common/types/endpoints`. Se configura en `private.metrics` (`ENDPOINT_METRICS_ENABLED`, `_FLUSH_INTERVAL_MS`, `_RETENTION_HOURS`; mínimo 25 = 24 + la que corre).

> Mongo se conecta **en segundo plano**: este servicio es `kernelMode` con `failOnError`, y esperar a la base pondría el boot entero detrás de ella. Mientras no conecte, la ventana muestra sólo la hora en curso.

> `GET /api/jobs/:jobId` y `GET /api/csrf-token` se registran directo contra el provider HTTP, **sin** el wrapper, así que quedan fuera de las métricas y del rate limit. `/api/jobs/:jobId` resuelve la sesión por su cuenta y **sólo se la devuelve a quien encoló el job** (`job.userId`); un job sin `userId` no se sirve a nadie. Mismo 404 para "no existe" y "no es tuyo".

### 7. Abstracción del Servidor HTTP

El `EndpointManagerService` no implementa un servidor HTTP por sí mismo. Delega esta tarea en un **Provider** (como `fastify-server`), lo que le permite centrarse en la lógica de gestión y ser independiente de la tecnología de servidor web subyacente.
