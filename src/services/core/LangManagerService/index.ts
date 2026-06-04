import * as fs from "node:fs/promises";
import * as path from "node:path";
import { BaseService } from "../../BaseService.js";
import { OnlyKernel } from "../../../utils/decorators/OnlyKernel.ts";
import type { ILangManagerService, TranslationDict, RegisteredNamespace } from "./types.js";

export default class LangManagerService extends BaseService implements ILangManagerService {
	public readonly name = "LangManagerService";

	private readonly namespaces = new Map<string, RegisteredNamespace>();
	private currentLocale: string;
	private readonly fallbackLocale: string;

	constructor(kernel: any, options?: any) {
		super(kernel, options);
		this.currentLocale = options?.defaultLocale || "en";
		this.fallbackLocale = options?.fallbackLocale || "en";
	}

	@OnlyKernel()
	async start(kernelKey: symbol): Promise<void> {
		await super.start(kernelKey);
		this.logger.logOk("LangManagerService iniciado");
	}

	@OnlyKernel()
	async stop(kernelKey: symbol): Promise<void> {
		await super.stop(kernelKey);
		this.namespaces.clear();
		this.logger.logOk("LangManagerService detenido");
	}

	async registerNamespace(namespace: string, appDir: string, dependencies?: string[]): Promise<void> {
		const i18nDir = path.join(appDir, "i18n");

		try {
			await fs.access(i18nDir);
		} catch {
			this.logger.logDebug(`No se encontró directorio i18n para ${namespace}`);
			return;
		}

		const translations: RegisteredNamespace["translations"] = {};
		const locales: string[] = [];

		try {
			const files = await fs.readdir(i18nDir);

			for (const file of files) {
				if (!file.endsWith(".js") && !file.endsWith(".json")) continue;

				const locale = file.replace(/\.(js|json)$/, "");
				const filePath = path.join(i18nDir, file);

				try {
					let content: TranslationDict;

					if (file.endsWith(".json")) {
						const rawContent = await fs.readFile(filePath, "utf-8");
						content = JSON.parse(rawContent);
					} else {
						// Para archivos .js, los importamos dinámicamente
						const fileUrl = `file://${filePath}`;
						const module = await import(fileUrl);
						content = module.default || module;
					}

					translations[locale] = content;
					locales.push(locale);
					this.logger.logDebug(`[${namespace}] Cargado locale: ${locale}`);
				} catch (error: any) {
					this.logger.logWarn(`Error cargando ${file} para ${namespace}: ${error.message}`);
				}
			}
		} catch (error: any) {
			this.logger.logWarn(`Error leyendo directorio i18n de ${namespace}: ${error.message}`);
			return;
		}

		if (locales.length === 0) {
			this.logger.logDebug(`No se encontraron archivos de traducción para ${namespace}`);
			return;
		}

		this.namespaces.set(namespace, {
			name: namespace,
			appDir,
			locales,
			translations,
			dependencies,
		});
		const depsText = dependencies?.length ? ` (deps: ${dependencies.join(", ")})` : "";
		this.logger.logOk(`[i18n] ${namespace}: ${locales.join(", ")}${depsText}`);
	}

	async unregisterNamespace(namespace: string): Promise<void> {
		if (this.namespaces.has(namespace)) {
			this.namespaces.delete(namespace);
			this.logger.logDebug(`Namespace ${namespace} desregistrado`);
		}
	}

	t(namespace: string, key: string, locale?: string, params?: Record<string, string>): string {
		const targetLocale = locale || this.currentLocale;
		const ns = this.namespaces.get(namespace);

		if (!ns) {
			return key;
		}

		// Intentar con el locale exacto, luego con el fallback
		let translation = this.#getNestedValue(ns.translations[targetLocale], key);

		if (!translation && targetLocale !== this.fallbackLocale) {
			// Intentar con locale base (ej: "es" si targetLocale es "es-AR")
			const baseLocale = targetLocale.split("-")[0];
			if (baseLocale !== targetLocale) {
				translation = this.#getNestedValue(ns.translations[baseLocale], key);
			}

			// Fallback final
			if (!translation) {
				translation = this.#getNestedValue(ns.translations[this.fallbackLocale], key);
			}
		}

		if (!translation) {
			return key;
		}

		// Interpolación de parámetros
		if (params) {
			return this.#interpolate(translation, params);
		}

		return translation;
	}

	getTranslations(namespace: string, locale?: string): TranslationDict {
		const targetLocale = locale || this.currentLocale;
		const ns = this.namespaces.get(namespace);

		if (!ns) {
			return {};
		}

		// Obtener traducciones base de dependencias (deep merge)
		let result: TranslationDict = {};
		if (ns.dependencies?.length) {
			for (const depName of ns.dependencies) {
				const depTranslations = this.#getRawTranslations(depName, targetLocale);
				result = this.#deepMerge(result, depTranslations);
			}
		}

		// Obtener traducciones propias del namespace
		const ownTranslations = this.#getRawTranslations(namespace, targetLocale);

		// Merge: las propias sobreescriben las de dependencias
		return this.#deepMerge(result, ownTranslations);
	}

	/**
	 * Obtiene traducciones sin resolver dependencias (para uso interno)
	 */
	#getRawTranslations(namespace: string, locale: string): TranslationDict {
		const ns = this.namespaces.get(namespace);
		if (!ns) return {};

		// Intentar con el locale exacto
		if (ns.translations[locale]) {
			return ns.translations[locale];
		}

		// Intentar con locale base
		const baseLocale = locale.split("-")[0];
		if (ns.translations[baseLocale]) {
			return ns.translations[baseLocale];
		}

		// Fallback
		return ns.translations[this.fallbackLocale] || {};
	}

	/**
	 * Deep merge de dos objetos de traducciones
	 */
	#deepMerge(target: TranslationDict, source: TranslationDict): TranslationDict {
		const result: TranslationDict = { ...target };

		for (const key of Object.keys(source)) {
			const sourceVal: TranslationDict = source[key];
			const targetVal: TranslationDict = result[key];

			if (typeof sourceVal === "object" && sourceVal !== null && typeof targetVal === "object" && targetVal !== null) {
				result[key] = this.#deepMerge(targetVal, sourceVal);
			} else {
				result[key] = sourceVal;
			}
		}

		return result;
	}

	getBundledTranslations(namespaces: string[], locale?: string): Record<string, TranslationDict> {
		const result: Record<string, TranslationDict> = {};

		for (const namespace of namespaces) {
			result[namespace] = this.getTranslations(namespace, locale);
		}

		return result;
	}

	getAvailableLocales(namespace: string): string[] {
		const ns = this.namespaces.get(namespace);
		return ns?.locales || [];
	}

	getCurrentLocale(): string {
		return this.currentLocale;
	}

	setCurrentLocale(locale: string): void {
		this.currentLocale = locale;
		this.logger.logDebug(`Locale cambiado a: ${locale}`);
	}

	getStats(): { namespaces: number; totalTranslations: number; currentLocale: string; registeredNamespaces: string[] } {
		let totalTranslations = 0;

		for (const ns of this.namespaces.values()) {
			for (const translations of Object.values(ns.translations)) {
				totalTranslations += this.#countKeys(translations);
			}
		}

		return {
			namespaces: this.namespaces.size,
			totalTranslations,
			currentLocale: this.currentLocale,
			registeredNamespaces: Array.from(this.namespaces.keys()),
		};
	}

	#getNestedValue(obj: TranslationDict | undefined, key: string): string | undefined {
		if (!obj) return undefined;

		const keys = key.split(".");
		let value: any = obj;

		for (const k of keys) {
			if (value && typeof value === "object" && k in value) {
				value = value[k];
			} else {
				return undefined;
			}
		}

		return typeof value === "string" ? value : undefined;
	}

	#interpolate(text: string, params: Record<string, string>): string {
		return text.replaceAll(/\{\{(\w+)\}\}/g, (_, key) => params[key] ?? `{{${key}}}`);
	}

	#countKeys(obj: TranslationDict): number {
		let count = 0;
		for (const value of Object.values(obj)) {
			if (typeof value === "string") {
				count++;
			} else {
				count += this.#countKeys(value);
			}
		}
		return count;
	}
}

export type { ILangManagerService, TranslationDict, RegisteredNamespace } from "./types.js";
