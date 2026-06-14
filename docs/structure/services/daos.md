# DAOs — Plantilla para crear un servicio

Este documento define cómo estructurar la capa de acceso y reglas de negocio al crear un servicio nuevo. Acá vive la lógica real del recurso: autorización fina, validaciones de negocio, persistencia y logging.

## Objetivo de la capa

Un DAO o manager debe encargarse de una única familia de entidades. Su contrato tiene que ser simple: recibir input ya validado en forma básica, aplicar reglas de negocio, persistir y devolver datos planos del dominio.

## Estructura mínima

```text
src/services/<layer>/<MyService>/
├── dao/
│   ├── shared.ts
│   ├── resources.ts
│   └── operations.ts
└── index.ts
```

- Un archivo por recurso principal.
- `shared.ts` sólo para helpers puros y reutilizables.
- Evitar crear jerarquías de herencia entre managers.

## Responsabilidades

Cada método público del DAO debería resolver:

1. Autorización.
2. Reglas de negocio.
3. Persistencia.
4. Logging si la operación cambia estado.

No debería resolver:

- Parsing HTTP.
- Validación trivial de shape.
- Construcción del contexto del caller.

## Contrato base

```ts
export class ResourceManager {
	readonly #permissionChecker: PermissionChecker;

	constructor(
		private readonly model: Model<Resource>,
		private readonly logger: ILogger,
		getAuthVerifier: AuthVerifierGetter = () => null
	) {
		this.#permissionChecker = new PermissionChecker(getAuthVerifier, "ResourceManager", RESOURCE_NAME);
	}
}
```

- Si el servicio usa permisos por recurso, pasar `RESOURCE_NAME`.
- Si hay dependencias cross-DAO, inyectarlas por constructor.
- El logger debe estar siempre disponible.

## Forma recomendada de los métodos

Orden sugerido para `create`, `update`, `delete` y operaciones especiales:

1. Cargar entidades necesarias.
2. Autorizar.
3. Validar reglas de negocio.
4. Construir el payload seguro.
5. Persistir.
6. Loguear.
7. Devolver plano.

## Autorización

La autorización va al comienzo del método público. Usar una sola estrategia principal por método.

```ts
await this.#permissionChecker.requirePermission(token, CRUDXAction.UPDATE, Scopes.RESOURCE, {
	ownerId: entity?.ownerId,
	allowIf: (userId) => entity?.ownerId === userId,
});
```

Reglas recomendadas:

- Si la operación depende sólo del permiso formal, no usar `allowIf`.
- Si existe acceso alternativo por owner, miembro o estado del recurso, expresarlo en `allowIf`.
- No hacer chequeos manuales de token antes de `requirePermission`, **salvo** en el patrón de manager dual descrito abajo.

## Managers internos (dual-mode)

Cuando un manager necesita ser usado tanto desde endpoints HTTP (con auth verifier) como desde servicios de infraestructura en contexto pre-autenticado (p.ej. `SessionManagerService` durante el login), se instancia con dos configuraciones:

- **Manager normal**: construido con el `getAuthVerifier` real → verifica tokens.
- **Manager interno**: construido con `() => null` → `PermissionChecker.requirePermission` hace short-circuit sin chequear nada.

El servicio dueño expone el interno vía un método anotado con `@OnlyKernel()`:

```ts
_internal(kernelKey: symbol): { myManager: MyManager } {
    if (kernelKey !== this.#kernelKey) throw new Error("Acceso denegado");
    return { myManager: this.#internalMyManager! };
}
```

Cuando un método del manager debe tocar la DB antes de poder autorizar (p.ej. necesita el ID del recurso para el `allowIf`), protegerlo de llamadas externas anónimas usando `getAuthVerifier` como discriminador:

```ts
constructor(..., getAuthVerifier: AuthVerifierGetter = () => null) {
    this.#permissionChecker = new PermissionChecker(getAuthVerifier, "MyManager", RESOURCE_NAME);
    this.#getAuthVerifier = getAuthVerifier;  // guardar para el guard manual
}

async getResource(id: string, token?: string): Promise<Resource | null> {
    if (this.#getAuthVerifier() !== null && !token) {
        throw new AuthorizationError("Token requerido", "NO_TOKEN");
    }
    const doc = await this.model.findOne({ id });
    await this.#permissionChecker.requirePermission(token, CRUDXAction.READ, Scopes.RESOURCE, {
        allowIf: (_uid, { orgId }) => orgId === doc?.orgId,
    });
    return doc ? toPlain(doc) : null;
}
```

- El manager interno (`getAuthVerifier = () => null`) ignora el guard y `requirePermission` hace short-circuit.
- El manager normal con verifier activo exige token antes de llegar a la DB.

## Política de `delete`

Usar patrón auth-first:

```ts
async delete(id: string, token?: string): Promise<void> {
    const entity = await findByIdAsPlain<Resource>(this.model, id);
    await this.#permissionChecker.requirePermission(token, CRUDXAction.DELETE, Scopes.RESOURCE, {
        ownerId: entity?.ownerId,
        allowIf: (userId) => entity?.ownerId === userId,
    });
    if (!entity) throw new MyServiceError(404, "NOT_FOUND", "Recurso no encontrado");
    const result = await this.model.deleteOne({ id });
    if (result.deletedCount === 0) throw new MyServiceError(404, "NOT_FOUND", "Recurso no encontrado");
    this.logger.logDebug(`Resource ${id} eliminado`);
}
```

- Primero autorizar.
- Después responder `404`.
- Evitar filtrar existencia a callers sin permiso.

## Helpers compartidos

Si el servicio tiene más de un DAO, centralizar helpers puros en `dao/shared.ts`.

Helpers típicos:

- `docToPlain<T>(doc)`.
- `findByIdAsPlain<T>(model, id)`.
- `stripImmutableFields<T>(updates, keys)`.
- `requireEntity<T>(fetcher, id, errorFactory)`.
- `fetchEntityWithParent<T>(model, id, fetchParent)` si existe jerarquía.
- Helpers de autorización del dominio si realmente se reutilizan.

Regla:

- Si un helper necesita estado del manager, probablemente no pertenece a `shared.ts`.
- Si un helper es específico de un solo recurso, dejarlo en ese archivo.

## Patrón de `create`

```ts
async create(input: CreateResourceInput, token?: string, caller?: CallerCtx): Promise<Resource> {
    await this.#permissionChecker.requirePermission(token, CRUDXAction.WRITE, Scopes.RESOURCE);

    const existing = await this.model.findOne({ slug: input.slug });
    if (existing) throw new MyServiceError(409, "ALREADY_EXISTS", "El recurso ya existe");

    const entity: Resource = {
        id: generateId(),
        name: input.name,
        createdAt: new Date(),
        updatedAt: new Date(),
    };

    await this.model.create(entity);
    this.logger.logDebug(`Resource ${entity.id} creado`);
    return entity;
}
```

## Patrón de `update`

```ts
const IMMUTABLE_FIELDS = ["id", "createdAt", "ownerId"] as const;

async update(id: string, updates: Partial<Resource>, token?: string): Promise<Resource> {
    const current = await findByIdAsPlain<Resource>(this.model, id);
    if (!current) throw new MyServiceError(404, "NOT_FOUND", "Recurso no encontrado");

    await this.#permissionChecker.requirePermission(token, CRUDXAction.UPDATE, Scopes.RESOURCE, {
        ownerId: current.ownerId,
    });

    const safe = {
        ...stripImmutableFields(updates, IMMUTABLE_FIELDS),
        updatedAt: new Date(),
    };

    const updated = await this.model.findOneAndUpdate({ id }, safe, { new: true });
    if (!updated) throw new MyServiceError(404, "NOT_FOUND", "Recurso no encontrado");
    return docToPlain<Resource>(updated)!;
}
```

Campos que suelen ser inmutables:

- `id`.
- `createdAt`.
- claves parent o tenant.
- ownership.
- contadores derivados.

## Paginación obligatoria en listados

Todo método que devuelva colecciones (`list*`, `search*`, `getAll*`) DEBE aceptar `limit`/`offset` (o cursor) y aplicar un **máximo duro** del lado del DAO. Nunca depender de que el endpoint o el cliente "se porten bien": una respuesta sin límite es un DoS accidental con colecciones grandes.

```ts
/** Límites del recurso: default razonable + máximo duro innegociable. */
const DEFAULT_LIST_LIMIT = 25;
const MAX_LIST_LIMIT = 100;

async list(opts: { limit?: number; offset?: number } = {}, token?: string): Promise<{ items: Resource[]; total: number }> {
    await this.#permissionChecker.requirePermission(token, CRUDXAction.READ, Scopes.RESOURCE);

    const limit = Math.min(Math.max(opts.limit ?? DEFAULT_LIST_LIMIT, 1), MAX_LIST_LIMIT);
    const offset = Math.max(opts.offset ?? 0, 0);

    const [docs, total] = await Promise.all([
        this.model.find({}).skip(offset).limit(limit).lean(),
        this.model.countDocuments({}),
    ]);
    return { items: docs.map(docToPlain<Resource>), total };
}
```

Reglas:

- `limit` se clampa SIEMPRE en el DAO (`Math.min(Math.max(...))`), aunque el endpoint también valide.
- Definir `DEFAULT_*_LIMIT` y `MAX_*_LIMIT` como constantes nombradas (nada de magic numbers inline).
- Devolver `total` (o `nextCursor`) para que la UI pueda paginar.
- Para colecciones con crecimiento no acotado (mensajes, logs, comments) preferir cursor (`createdAt + id`) sobre `skip`, que degrada en Mongo con offsets grandes.
- Los queries con `$regex` derivados de input DEBEN escapar el patrón con `escapeRegex` de `@common/utils/escape.ts`.

### Barridos que deben procesar TODO

Las operaciones de mantenimiento que recorren la colección entera (purga de cuenta, recuperación masiva, cascadas de borrado) no pueden clamearse ni cargar todo de una. Paginá por cursor con `forEachPage` de `@common/utils/batch.ts`: procesa en lotes acotados (memoria O(lote)) y nunca relee items ya vistos, así que no se cuelga aunque `handlePage` mute la colección.

- Exponé desde el DAO un `findXPage(…, afterId, limit)` con `.sort({ id: 1 }).limit(limit)` y filtro `id > afterId`; no un método full-scan.
- Borrá/marcá dentro de `handlePage`: el barrido queda naturalmente reanudable (si se corta, la próxima corrida retoma lo que quede).
- Si además cruza varios pasos o servicios, hacelo reanudable a nivel orquestación con `OperationsService.stepper` (pasos idempotentes; borrá el registro raíz al final).

## Dependencias entre DAOs

Si un DAO necesita leer o mutar datos internos de otro, exponer internals controlados desde el manager dueño del recurso.

```ts
@OnlyKernel()
getInternals(_kernelKey: symbol): ResourceInternals {
    return {
        fetchById: (id) => this.#fetchById(id),
    };
}
```

- No exponer modelos directamente.
- No duplicar lógica privada en varios managers.
- Pasar internals por constructor al consumidor.

## Logging

Usar logging de negocio, no logging narrativo.

- `logDebug` para create, update, delete y cambios de estado.
- `logError` sólo cuando se atrapa un error y se hace recovery o traducción.
- Nunca loguear tokens, hashes o datos sensibles.

## Anti-patrones

- Validar shape trivial en la DAO.
- Hacer acceso a HTTP o `EndpointCtx` desde esta capa.
- Duplicar helpers pequeños en cada archivo.
- Crear una `BaseDAO<T>` genérica sólo para ahorrar pocas líneas.
- Mezclar dos recursos distintos en un mismo manager.

## Checklist de creación

- [ ] Cada recurso tiene su propio manager.
- [ ] El constructor recibe sólo dependencias reales.
- [ ] La autorización vive al inicio de cada método público.
- [ ] `shared.ts` contiene sólo helpers puros.
- [ ] `create`, `update` y `delete` siguen un orden estable.
- [ ] Los campos inmutables están centralizados en una constante.
- [ ] Los métodos devuelven objetos planos del dominio.
- [ ] Hay logs en cambios de estado importantes.
- [ ] Todo listado/búsqueda pagina con `limit` clampado a un máximo duro.
- [ ] Los barridos full-collection (purga/cascada/recuperación) usan `forEachPage` por cursor, no full-scan.
- [ ] Los `$regex` desde input usan `escapeRegex` de `@common/utils/escape.ts`.
