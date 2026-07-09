import { Scope } from "@common/security/Capability.ts";
import { Logger } from "../../utils/logger/Logger.js";

/**
 * Política de capabilities: a partir del tipo, la ubicación (tier) y los privilegios
 * declarados en `config.json`, calcula los scopes del **businessCap** de un módulo.
 *
 * Filosofía: defaults de grano grueso por tier + opt‑in explícito para lo peligroso,
 * con una lista negra que **jamás** concede scopes de infraestructura a un módulo.
 */

export type ModuleKind = "service" | "provider" | "utility" | "app";
export type ModuleTier = "core" | "feature" | "app" | "infra";

/**
 * Scopes que un módulo **jamás** puede obtener en su businessCap vía `privileges`,
 * aunque los declare: los de la maquinaria de carga (`infraCap`) y el de control de
 * plataforma (`platform:infra`), que sólo mintea el kernel para sí mismo.
 */
const INFRA_ONLY: ReadonlySet<Scope> = new Set([Scope.RegistryWrite, Scope.ModuleLoader, Scope.PlatformInfra]);

/**
 * Scopes que hoy sólo usan apps de test (SYSTEM user + login programático). Se conceden
 * únicamente cuando los tests pueden cargarse (misma condición que `excludeTests` en el
 * kernel); en producción sin `ENABLE_TESTS` se ignoran aunque un módulo los declare.
 */
const TEST_ONLY: ReadonlySet<Scope> = new Set([Scope.IdentitySystem, Scope.SessionProgrammatic]);
const TESTS_ENABLED = process.env.ENABLE_TESTS === "true" || process.env.NODE_ENV === "development";

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
		if (!known.has(raw)) {
			// Scope declarado inexistente (típicamente un typo en `privileges`): lo ignoramos
			// pero avisamos, porque en silencio se traduce en un privilegio ausente en runtime.
			Logger.warn(`[capabilityPolicy] privilegio desconocido '${raw}' en '${opts.path}' ignorado (¿typo?)`);
			continue;
		}
		const scope = raw as Scope;
		if (INFRA_ONLY.has(scope)) continue; // nunca concedido a businessCap
		if (!TESTS_ENABLED && TEST_ONLY.has(scope)) {
			Logger.warn(`[capabilityPolicy] scope de test '${raw}' en '${opts.path}' ignorado: no se concede en producción`);
			continue;
		}
		scopes.add(scope);
	}
	return [...scopes];
}
