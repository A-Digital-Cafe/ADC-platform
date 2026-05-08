# EndpointManagerService

Este servicio es el núcleo de la gestión de endpoints HTTP de la plataforma. Centraliza el registro de rutas, la validación de permisos y el manejo de solicitudes, actuando como un orquestador entre los servicios de negocio y el proveedor del servidor HTTP.

## Flujo de Trabajo y Características

El flujo de trabajo se basa en un sistema declarativo mediante decoradores, lo que simplifica la creación de APIs seguras y consistentes.

### 1. Registro Declarativo de Endpoints

Los endpoints se definen directamente en los métodos de un servicio utilizando el decorador `@RegisterEndpoint`. Esto mantiene la lógica del endpoint y su configuración en el mismo lugar.

```typescript
import { EnableEndpoints, DisableEndpoints, RegisterEndpoint, EndpointCtx } from "./EndpointManagerService/index.js";

class MyDataService extends BaseService {
	@RegisterEndpoint({
		method: "GET",
		url: "/api/data/:id",
		permissions: ["data.read"], // Permisos requeridos
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

### 2. Ciclo de Vida Automático

El registro y desregistro de los endpoints está ligado al ciclo de vida del servicio que los contiene.

- **`@EnableEndpoints()`**: Usado en el método `start()` de un servicio, le indica al `EndpointManagerService` que registre todos los endpoints decorados en ese servicio.
- **`@DisableEndpoints()`**: Usado en el método `stop()`, limpia automáticamente todos los endpoints de ese servicio.

### 3. Gestión de Seguridad y Permisos

La seguridad es una responsabilidad compartida entre `EndpointManagerService` y `SessionManagerService`, cada uno con un rol bien definido. El proceso se desencadena de forma transparente gracias a los decoradores.

#### El Flujo de Validación de una Petición

1.  **Wrapper y Extracción de Token**: Cada petición a un endpoint es interceptada por un "wrapper" lógico. Lo primero que hace es buscar un token de usuario en las cookies, cabeceras (`Authorization: Bearer`) o parámetros de la URL.

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

### 6. Abstracción del Servidor HTTP

El `EndpointManagerService` no implementa un servidor HTTP por sí mismo. Delega esta tarea en un **Provider** (como `fastify-server`), lo que le permite centrarse en la lógica de gestión y ser independiente de la tecnología de servidor web subyacente.
