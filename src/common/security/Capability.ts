import { CapabilityError } from "../types/custom-errors/CapabilityError.ts";

/**
 * Permisos (scopes) que una {@link Capability} puede portar. Cada superficie
 * privilegiada del kernel/servicios valida un scope concreto en vez de comparar
 * igualdad de llave. Mantener la lista corta y de grano grueso.
 */
export enum Scope {
	/** Ciclo de vida `start`/`stop`. Lo porta cada módulo. */
	Lifecycle = "lifecycle",
	/** Mutar el registry (registrar/descargar). **Sólo** capability de infraestructura. */
	RegistryWrite = "registry:write",
	/** Cargar/instanciar código y leer `.env`. **Sólo** capability de infraestructura. */
	ModuleLoader = "module:loader",
	/** Cargar/descargar/deshabilitar módulos vía el orquestador. */
	Orchestrator = "orchestrator",
	/** Acceso interno a IdentityManager: managers de users/orgs/roles (`_internal`). */
	IdentityInternal = "identity:internal",
	/** Acceso al manager de attachments de avatares de IdentityManager (`_internalAvatar`). */
	IdentityAvatar = "identity:avatar",
	/** Acceso al mapeo de roles Discord de IdentityManager (`_internalDiscord`). */
	IdentityDiscord = "identity:discord",
	/** Acceso interno a ModerationService (`_internal`). */
	ModerationInternal = "moderation:internal",
	/** Obtener la instancia cruda del servidor HTTP (fastify `getApp`). */
	HttpRaw = "http:raw",
	/** Registrar/desregistrar un módulo UI en UIFederation. */
	UiRegister = "ui:register",
	/** Registrarse como app consumidora en StorageQuotaService. */
	StorageRegister = "storage:register",
	/** Anunciar a TODOS los usuarios (`NotificationService.broadcast`). Amplifica ×N: opt-in explícito. */
	NotificationsBroadcast = "notifications:broadcast",
}

/** Símbolo de minteo: privado del módulo, nunca se exporta. */
const MINT: unique symbol = Symbol("capability-mint");

/**
 * Token de autorización **por instancia de módulo**, infalsificable. Reemplaza a
 * la `kernelKey` compartida: cada módulo recibe el suyo, acotado a los scopes que
 * su tier/declaración le concede.
 *
 * Infalsificable porque:
 *  - sólo puede construirse con el símbolo privado {@link MINT} (lo tiene el
 *    {@link CapabilityIssuer}, que vive en este módulo y no lo expone), y
 *  - {@link Capability.is} usa un *brand check* por campo privado (`#scopes in o`),
 *    imposible de imitar con un objeto plano.
 */
export class Capability {
	readonly #scopes: ReadonlySet<Scope>;
	readonly #owner: string;
	readonly #type: string;

	constructor(mint: symbol, owner: string, type: string, scopes: Iterable<Scope>) {
		if (mint !== MINT) {
			throw new CapabilityError(500, "INVALID_CAPABILITY", "Capability sólo puede mintearse por el CapabilityIssuer");
		}
		this.#scopes = Object.freeze(new Set(scopes));
		this.#owner = owner;
		this.#type = type;
	}

	/** `true` si esta capability porta el scope dado. */
	has(scope: Scope): boolean {
		return this.#scopes.has(scope);
	}

	/** Nombre/instancia del módulo titular (para auditoría y diagnósticos). */
	get owner(): string {
		return this.#owner;
	}

	/** Tipo del titular (`service` | `provider` | `utility` | `app` | `infra`). */
	get type(): string {
		return this.#type;
	}

	/** Brand check infalsificable: sólo instancias reales pasan. */
	static is(o: unknown): o is Capability {
		return typeof o === "object" && o !== null && #scopes in o;
	}
}

/**
 * Único emisor de {@link Capability}. Lo posee el Kernel de forma privada; ningún
 * módulo puede instanciarlo con el símbolo de minteo, de modo que no puede forjar
 * capabilities ni ampliar sus propios scopes.
 */
export class CapabilityIssuer {
	mint(owner: string, type: string, scopes: Iterable<Scope>): Capability {
		return new Capability(MINT, owner, type, scopes);
	}
}

/**
 * Token aceptado por las superficies gateadas. Es una {@link Capability} con scope o,
 * **transitoriamente**, la master key del kernel (`symbol`) en las superficies que aún
 * mantienen doble aceptación. El *flip* final retira la rama `symbol` de esos gates,
 * dejando sólo capabilities con scope.
 */
export type CapabilityToken = Capability | symbol;

/**
 * Valida que `arg` autorice `scope`. Durante la migración acepta también la
 * `masterKey` (doble aceptación); ese parámetro se retira en la fase final para
 * que los módulos sólo puedan presentar capabilities con scope.
 *
 * @throws {CapabilityError} si no autoriza.
 */
export function assertScope(arg: CapabilityToken, scope: Scope, masterKey?: symbol | null): void {
	if (masterKey != null && arg === masterKey) return;
	if (Capability.is(arg) && arg.has(scope)) return;
	const who = Capability.is(arg) ? `${arg.type}:${arg.owner}` : "desconocido";
	throw new CapabilityError(403, "MISSING_SCOPE", `Acceso denegado: falta capability con scope '${scope}' (titular: ${who})`, {
		scope,
	});
}
