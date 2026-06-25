import { Scope } from "@common/security/Capability.ts";

/**
 * Política de capabilities: a partir del tipo, la ubicación (tier) y los privilegios
 * declarados en `config.json`, calcula los scopes del **businessCap** de un módulo.
 *
 * Filosofía: defaults de grano grueso por tier + opt‑in explícito para lo peligroso,
 * con una lista negra que **jamás** concede scopes de infraestructura a un módulo.
 */

export type ModuleKind = "service" | "provider" | "utility" | "app";
export type ModuleTier = "core" | "feature" | "app" | "infra";

/** Scopes que sólo viven en el `infraCap` (maquinaria de carga), nunca en un businessCap. */
const INFRA_ONLY: ReadonlySet<Scope> = new Set([Scope.RegistryWrite, Scope.ModuleLoader]);

/**
 * Scopes del `infraCap` que el kernel/loaders usan para registrar sub‑dependencias.
 * Igual para cada módulo; nunca se expone a la lógica de negocio.
 */
export const INFRA_CAP_SCOPES: readonly Scope[] = [Scope.Lifecycle, Scope.RegistryWrite, Scope.ModuleLoader];

const TIER_DEFAULTS: Record<ModuleTier, readonly Scope[]> = {
	// Todo scope privilegiado (identity:*, moderation:internal, http:raw, orchestrator,
	// storage:register) es **opt-in por servicio** vía `config.json` → `privileges`.
	// Por defecto un módulo sólo recibe su ciclo de vida.
	core: [Scope.Lifecycle],
	feature: [Scope.Lifecycle],
	// Apps: además registran su módulo UI (función propia, no escalación cross-service).
	app: [Scope.Lifecycle, Scope.UiRegister],
	infra: [Scope.Lifecycle],
};

/** Deriva el tier de un módulo por su tipo y ruta de origen. */
export function tierForPath(path: string, kind: ModuleKind): ModuleTier {
	if (kind === "app") return "app";
	if (kind === "provider" || kind === "utility") return "infra";
	const p = path.replaceAll("\\", "/");
	if (p.includes("/services/core/") || p.includes("/services/security/")) return "core";
	return "feature";
}

/**
 * Calcula los scopes del businessCap: defaults del tier ∪ privilegios declarados
 * (ignorando desconocidos y los reservados a infraestructura).
 */
export function policyScopes(opts: { path: string; kind: ModuleKind; declared?: readonly string[] }): Scope[] {
	const tier = tierForPath(opts.path, opts.kind);
	const scopes = new Set<Scope>(TIER_DEFAULTS[tier]);

	const known = new Set<string>(Object.values(Scope));
	for (const raw of opts.declared ?? []) {
		if (!known.has(raw)) continue; // ignora scopes inexistentes
		const scope = raw as Scope;
		if (INFRA_ONLY.has(scope)) continue; // nunca concedido a businessCap
		scopes.add(scope);
	}
	return [...scopes];
}
