import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { IModuleConfig } from "../../interfaces/modules/IModule.js";
import { safeParseJson } from "@common/utils/json-schema.ts";
import { moduleConfigCheck } from "@common/schemas/module-config.ts";

/**
 * Fusión de configuraciones de app: `default.json` (base) + config de instancia.
 * Lógica pura y testeable, extraída de BaseApp (responsabilidad única).
 */

/** Fusiona listas de módulos por nombre (la instancia pisa la base campo a campo). */
function mergeModules(base: IModuleConfig[] = [], instance: IModuleConfig[] = []): IModuleConfig[] {
	const byName = new Map(base.map((item) => [item.name, item]));
	for (const item of instance) {
		const existing = byName.get(item.name) || {};
		byName.set(item.name, { ...existing, ...item });
	}
	return Array.from(byName.values());
}

/** Lee el `default.json` de la app si existe. */
export async function readBaseConfig(appDir: string): Promise<Partial<IModuleConfig>> {
	try {
		const content = await fs.readFile(path.join(appDir, "default.json"), "utf-8");
		return (safeParseJson(content, moduleConfigCheck) as Partial<IModuleConfig> | null) ?? {};
	} catch {
		return {};
	}
}

/**
 * Combina la config base con la de instancia. Los servicios sin providers
 * propios heredan los providers globales fusionados (para que usen la
 * configuración correcta del provider global).
 */
export function mergeAppConfigs(baseConfig: Partial<IModuleConfig>, instanceConfig: Partial<IModuleConfig>): IModuleConfig {
	const mergedProviders = mergeModules(baseConfig.providers, instanceConfig.providers);
	const mergedUtilities = mergeModules(baseConfig.utilities, instanceConfig.utilities);
	const mergedServices = mergeModules(baseConfig.services, instanceConfig.services);

	const servicesWithInheritedProviders = mergedServices.map((service: IModuleConfig) => {
		if (!service.providers || service.providers.length === 0) {
			return { ...service, providers: mergedProviders };
		}
		return service;
	});

	return {
		...baseConfig,
		...instanceConfig,
		failOnError: instanceConfig.failOnError ?? baseConfig.failOnError,
		providers: mergedProviders,
		utilities: mergedUtilities,
		services: servicesWithInheritedProviders,
	} as IModuleConfig;
}
