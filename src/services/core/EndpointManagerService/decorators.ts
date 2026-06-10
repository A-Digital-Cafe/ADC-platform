import { AuthError } from "@common/types/custom-errors/AuthError.ts";
import type { EndpointConfig, EnableEndpointsConfig, HttpMethod, EndpointCtx } from "./types.js";

/**
 * Símbolos para metadata
 */
const REGISTERED_ENDPOINTS = Symbol("__registeredEndpoints__");
const ENABLE_ENDPOINTS_META = Symbol("__enableEndpointsConfig__");
const DISABLE_ENDPOINTS_META = Symbol("__disableEndpointsConfig__");

/**
 * Almacena la kernelKey capturada en el start() de cada instancia para poder
 * invocar métodos protegidos con @OnlyKernel (p.ej. unregisterEndpointsByOwner)
 * durante el stop(), cuyo argumento puede no incluir la kernelKey.
 */
const instanceKernelKeys = new WeakMap<object, symbol>();
const PERMISSION_VALIDATOR = Symbol("__permissionValidator__");

/**
 * Tipo para función de validación de permisos
 */
type PermissionValidator = (
	token: string | null,
	requiredPermissions: string[]
) => Promise<{
	valid: boolean;
	user: { id: string; username: string; email?: string; permissions: string[] } | null;
	error?: string;
}>;

/**
 * Almacenamiento de metadata de endpoints por clase
 */
interface EndpointMetadata {
	method: HttpMethod;
	url: string;
	permissions: string[];
	options?: EndpointConfig["options"];
	methodName: string;
	// eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
	originalMethod: Function;
}

/**
 * Obtiene o crea el array de endpoints registrados en una clase
 * Soporta tanto métodos de instancia (target = prototype) como estáticos (target = constructor)
 */
function getEndpointMetadata(target: object): EndpointMetadata[] {
	// Para métodos estáticos, target ES el constructor (la clase)
	// Para métodos de instancia, target es el prototype, y target.constructor es la clase
	const constructor = typeof target === "function" ? target : target.constructor;
	if (!Object.hasOwn(constructor, REGISTERED_ENDPOINTS)) {
		Object.defineProperty(constructor, REGISTERED_ENDPOINTS, {
			value: [],
			writable: false,
			enumerable: false,
			configurable: false,
		});
	}
	return (constructor as any)[REGISTERED_ENDPOINTS];
}

/**
 * Lee los endpoints registrados de una clase (sin modificar)
 */
export function readEndpointMetadata(target: object | (new (...args: any[]) => object)): EndpointMetadata[] {
	const constructor = typeof target === "function" ? target : target.constructor;
	return (constructor as any)[REGISTERED_ENDPOINTS] || [];
}

/**
 * Lee la configuración de EnableEndpoints de una clase
 */
export function readEnableEndpointsConfig(target: object | (new (...args: any[]) => object)): EnableEndpointsConfig | undefined {
	const constructor = typeof target === "function" ? target : target.constructor;
	return (constructor as any)[ENABLE_ENDPOINTS_META];
}

/**
 * Establece el validador de permisos para una instancia
 * Llamado por EndpointManagerService al registrar endpoints
 */
export function setPermissionValidator(instance: object, validator: PermissionValidator): void {
	(instance as any)[PERMISSION_VALIDATOR] = validator;
}

/**
 * Obtiene el validador de permisos de una instancia
 */
function getPermissionValidator(instance: object): PermissionValidator | null {
	return (instance as any)[PERMISSION_VALIDATOR] || null;
}

/**
 * @RegisterEndpoint - Decorator para marcar métodos como endpoints HTTP
 *
 * El método decorado:
 * - Recibe un único parámetro `ctx: EndpointCtx<P, D>` con params, query, data, user, token
 * - Devuelve datos directamente (no maneja HTTP)
 * - Lanza HttpError para errores de negocio
 * - Valida permisos ANTES de ejecutar (si permissions no está vacío)
 *
 * @param config - Configuración del endpoint (method, url, permissions, options)
 *
 * @example
 * ```typescript
 * class ContentService extends BaseService {
 *   @RegisterEndpoint({
 *     method: "GET",
 *     url: "/api/articles/:slug",
 *     permissions: [], // público
 *   })
 *   async getArticle(ctx: EndpointCtx<{ slug: string }>) {
 *     const article = await this.findBySlug(ctx.params.slug);
 *     if (!article) throw new HttpError(404, "NOT_FOUND", "Article not found");
 *     return article;
 *   }
 *
 *   @RegisterEndpoint({
 *     method: "POST",
 *     url: "/api/articles",
 *     permissions: ["content.write"],
 *   })
 *   async createArticle(ctx: EndpointCtx<{}, CreateArticleDTO>) {
 *     // ctx.user garantizado no-null porque permissions no vacío
 *     return await this.create(ctx.data, ctx.user!.id);
 *   }
 * }
 * ```
 */
export function RegisterEndpoint(config: Omit<EndpointConfig, "handler">): MethodDecorator {
	return function (target: object, propertyKey: string | symbol, descriptor: PropertyDescriptor) {
		const methodName = String(propertyKey);
		const originalMethod = descriptor.value;
		const permissions = config.permissions || [];
		const deferAuth = config.deferAuth === true;
		const requireAuth = config.requireAuth === true;

		// Guardar metadata del endpoint
		const endpoints = getEndpointMetadata(target);
		endpoints.push({
			method: config.method,
			url: config.url,
			permissions,
			options: config.options,
			methodName,
			originalMethod,
		});

		// Wrap del método para validar permisos SIEMPRE (incluso llamadas directas)
		descriptor.value = async function (this: any, ctx: EndpointCtx<any, any>) {
			await enforceEndpointAuth(this, ctx, { deferAuth, requireAuth, permissions });

			// Ejecutar método original
			return originalMethod.call(this, ctx);
		};

		return descriptor;
	};
}

/** Aplica la política de auth del endpoint (deferAuth/requireAuth/permissions) sobre el ctx. */
async function enforceEndpointAuth(
	instance: object,
	ctx: EndpointCtx<any, any>,
	policy: { deferAuth: boolean; requireAuth: boolean; permissions: string[] }
): Promise<void> {
	const { deferAuth, requireAuth, permissions } = policy;

	// deferAuth/requireAuth: verificar token (si hay) y poblar ctx.user. El DAO autoriza.
	if (deferAuth || requireAuth) {
		const validator = getPermissionValidator(instance);
		if (validator) {
			const result = await validator(ctx.token, []);
			(ctx as any).user = result.user;
		} else if (requireAuth) {
			throw new AuthError(503, "AUTH_UNAVAILABLE", "Authentication service not available");
		}
		// requireAuth: red de seguridad — sin sesión válida el handler nunca se ejecuta.
		if (requireAuth && !(ctx as any).user) {
			throw new AuthError(401, "UNAUTHORIZED", "Authentication required");
		}
		return;
	}

	if (permissions.length === 0) return;

	const validator = getPermissionValidator(instance);
	// Sin validador configurado - si hay permisos requeridos, fallar
	if (!validator) throw new AuthError(503, "AUTH_UNAVAILABLE", "Authentication service not available");

	const result = await validator(ctx.token, permissions);
	if (!result.valid) {
		throw new AuthError(
			ctx.token ? 403 : 401,
			ctx.token ? "FORBIDDEN" : "UNAUTHORIZED",
			result.error || (ctx.token ? "Insufficient permissions" : "Authentication required")
		);
	}

	// Actualizar user en ctx con el resultado de la validación
	(ctx as any).user = result.user;
}

/**
 * @EnableEndpoints - Decorator para el método start() que activa el registro de endpoints
 *
 * @param config - Configuración opcional con getter de managers adicionales
 */
export function EnableEndpoints(config?: EnableEndpointsConfig): MethodDecorator {
	return function (target: object, propertyKey: string | symbol, descriptor: PropertyDescriptor) {
		const constructor = target.constructor;

		Object.defineProperty(constructor, ENABLE_ENDPOINTS_META, {
			value: {
				methodName: String(propertyKey),
				managersGetter: config?.managers,
			},
			writable: false,
			enumerable: false,
			configurable: false,
		});

		const originalMethod = descriptor.value;

		descriptor.value = async function (this: any, ...args: any[]) {
			const result = await originalMethod.apply(this, args);

			// Capturar la kernelKey (primer argumento de start) para el teardown
			if (typeof args[0] === "symbol") instanceKernelKeys.set(this, args[0]);

			this.logger?.logDebug(`[EnableEndpoints] Intentando registrar endpoints para ${this.name || this.constructor.name}`);

			try {
				await registerEndpointsForInstance(this, config?.managers);
			} catch (error) {
				this.logger?.logWarn(`Error registrando endpoints: ${error}`);
			}

			return result;
		};

		return descriptor;
	};
}

/**
 * @DisableEndpoints - Decorator para el método stop() que desactiva los endpoints
 */
export function DisableEndpoints(): MethodDecorator {
	return function (target: object, propertyKey: string | symbol, descriptor: PropertyDescriptor) {
		const constructor = target.constructor;
		const methodName = String(propertyKey);

		let disableConfig = (constructor as any)[DISABLE_ENDPOINTS_META];
		if (!disableConfig) {
			disableConfig = { methods: [] };
			Object.defineProperty(constructor, DISABLE_ENDPOINTS_META, {
				value: disableConfig,
				writable: false,
				enumerable: false,
				configurable: false,
			});
		}
		disableConfig.methods.push(methodName);

		const originalMethod = descriptor.value;

		descriptor.value = async function (this: any, ...args: any[]) {
			try {
				await unregisterEndpointsForInstance(this);
			} catch (error) {
				this.logger?.logWarn(`Error desregistrando endpoints: ${error}`);
			}

			return originalMethod.apply(this, args);
		};

		return descriptor;
	};
}

/**
 * Registra endpoints para una instancia de servicio/app
 */
async function registerEndpointsForInstance(instance: any, managersGetter?: () => object[]): Promise<void> {
	const endpointManager = getEndpointManagerService(instance);
	if (!endpointManager) {
		instance.logger?.logWarn(`[EnableEndpoints] EndpointManagerService NO encontrado para ${instance.name}`);
		return;
	}

	const ownerName = instance.name || instance.constructor.name;

	// 1. Registrar endpoints de la propia instancia
	const ownEndpoints = readEndpointMetadata(instance);
	instance.logger?.logDebug(`[EnableEndpoints] ${ownerName} tiene ${ownEndpoints.length} endpoints propios`);

	for (const ep of ownEndpoints) {
		await endpointManager.registerEndpoint({
			method: ep.method,
			url: ep.url,
			permissions: ep.permissions,
			options: ep.options,
			instance,
			methodName: ep.methodName,
			// El handler ya está wrapped con validación de permisos
			handler: instance[ep.methodName].bind(instance),
			ownerName,
		});
	}

	// 2. Registrar endpoints de managers
	if (managersGetter) {
		try {
			const managers = managersGetter.call(instance);
			instance.logger?.logDebug(`[EnableEndpoints] ${ownerName} tiene ${managers?.length || 0} managers`);

			for (const managerInstance of managers) {
				if (!managerInstance) continue;

				const managerEndpoints = readEndpointMetadata(managerInstance);
				const managerName = managerInstance.constructor.name;

				instance.logger?.logDebug(`[EnableEndpoints] Manager ${managerName} tiene ${managerEndpoints.length} endpoints`);

				for (const ep of managerEndpoints) {
					await endpointManager.registerEndpoint({
						method: ep.method,
						url: ep.url,
						permissions: ep.permissions,
						options: ep.options,
						instance: managerInstance,
						methodName: ep.methodName,
						handler: (managerInstance as any)[ep.methodName].bind(managerInstance),
						ownerName: `${ownerName}::${managerName}`,
					});
				}
			}
		} catch (error) {
			instance.logger?.logWarn(`Error obteniendo managers: ${error}`);
		}
	}
}

/**
 * Desregistra todos los endpoints de una instancia
 */
async function unregisterEndpointsForInstance(instance: any): Promise<void> {
	const endpointManager = getEndpointManagerService(instance);
	if (!endpointManager) return;

	const kernelKey = instanceKernelKeys.get(instance);
	if (!kernelKey) {
		instance.logger?.logWarn("[DisableEndpoints] kernelKey no disponible; no se pueden desregistrar endpoints");
		return;
	}

	const ownerName = instance.name || instance.constructor.name;
	await endpointManager.unregisterEndpointsByOwner(kernelKey, ownerName);
}

/**
 * Obtiene el EndpointManagerService desde el kernel
 */
function getEndpointManagerService(instance: any): any {
	try {
		if (typeof instance.getMyService === "function") return instance.getMyService("EndpointManagerService");

		if (instance.kernel?.registry) return instance.kernel.registry.getService("EndpointManagerService");

		if (instance.config?.services) {
			const hasEndpointManager = instance.config.services.some((s: any) => s.name === "EndpointManagerService");
			if (hasEndpointManager && typeof instance.getMyService === "function") return instance.getMyService("EndpointManagerService");
		}
	} catch {
		// EndpointManagerService no disponible
	}
	return null;
}
