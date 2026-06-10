/**
 * React hooks for ADC i18n system
 *
 * Use these hooks to access translations loaded by the ADC i18n client.
 */

import { useState, useEffect, useCallback, useMemo } from "react";
import { createUiLogger } from "./ui-logger.js";

const logger = createUiLogger("i18n-react");

interface ADCGlobal {
	__ADC_I18N__?: {
		translations: Record<string, Record<string, unknown>>;
		translationLocales?: Record<string, string>;
		locale: string | null;
		loading: boolean;
		loaded: boolean;
	};
	t?: (key: string, params?: Record<string, string> | null, namespace?: string) => string;
	loadTranslations?: (namespaces: string[], locale?: string) => Promise<void>;
	getLocale?: () => string;
	setLocale?: (locale: string) => void;
}
const customThis = globalThis as typeof globalThis & ADCGlobal;

function areNamespacesLoaded(namespaces: string[]): boolean {
	if (namespaces.length === 0) return true;

	const state = customThis.__ADC_I18N__;
	if (!state) return false;

	const targetLocale = state.locale || localStorage.getItem("language") || navigator.language?.split("-")[0] || "en";
	return namespaces.every((namespace) => {
		if (!(namespace in state.translations)) return false;
		return !state.translationLocales?.[namespace] || state.translationLocales[namespace] === targetLocale;
	});
}

function eventMatchesNamespaces(detail: unknown, namespaces: string[]): boolean {
	if (namespaces.length === 0) return true;
	const loadedNamespaces = (detail as { namespaces?: unknown })?.namespaces;
	return Array.isArray(loadedNamespaces) && loadedNamespaces.some((namespace) => namespaces.includes(String(namespace)));
}

export interface UseTranslationOptions {
	/** Namespace(s) to load translations from */
	namespace?: string | string[];
	/** If true, automatically load translations on mount */
	autoLoad?: boolean;
}

export interface UseTranslationReturn {
	/** Translation function */
	t: (key: string, params?: Record<string, string>) => string;
	/** Current locale */
	locale: string;
	/** Whether translations are loaded */
	ready: boolean;
	/** Change locale */
	setLocale: (locale: string) => void;
}

/**
 * React hook for accessing translations
 *
 * @example
 * ```tsx
 * function LoginForm() {
 *   const { t, ready } = useTranslation({ namespace: "adc-auth", autoLoad: true });
 *
 *   if (!ready) return <div>Loading...</div>;
 *
 *   return (
 *     <form>
 *       <h1>{t("login.title")}</h1>
 *       <input placeholder={t("login.username")} />
 *     </form>
 *   );
 * }
 * ```
 */
export function useTranslation(options: UseTranslationOptions = {}): UseTranslationReturn {
	const { namespace, autoLoad = true } = options;

	// Estabilizar namespaces para evitar re-renders infinitos
	const namespacesKey = Array.isArray(namespace) ? namespace.join(",") : namespace || "";
	const namespaces = useMemo(() => {
		if (Array.isArray(namespace)) return namespace;
		return namespace ? [namespace] : [];
	}, [namespacesKey]);

	// Counter para forzar re-cálculo de t() cuando las traducciones cambian
	const [translationsVersion, setTranslationsVersion] = useState(0);

	const [ready, setReady] = useState(() => {
		// Check if translations are already loaded
		// Nota: usamos namespace directamente aquí porque namespaces aún no está calculado
		let ns: string[];
		if (Array.isArray(namespace)) ns = namespace;
		else if (namespace) ns = [namespace];
		else ns = [];
		return areNamespacesLoaded(ns);
	});

	const [locale, setLocale] = useState(() => {
		return customThis.__ADC_I18N__?.locale || localStorage.getItem("language") || navigator.language?.split("-")[0] || "en";
	});

	// Translation function
	const t = useCallback(
		(key: string, params?: Record<string, string>): string => {
			// Use global t() if available
			if (customThis.t) {
				const ns = namespaces[0];
				return customThis.t(key, params || null, ns);
			}

			// Fallback: direct lookup
			const state = customThis.__ADC_I18N__;
			if (!state) return key;

			const ns = namespaces[0];
			const translations = ns ? state.translations[ns] : Object.values(state.translations)[0];
			if (!translations) return key;

			const keys = key.split(".");
			let value: unknown = translations;
			for (const k of keys) {
				if (value && typeof value === "object" && k in value) {
					value = (value as Record<string, unknown>)[k];
				} else {
					return key;
				}
			}

			if (typeof value !== "string") return key;

			// Interpolation
			if (params) {
				return value.replaceAll(/\{\{(\w+)\}\}/g, (_, p) => params[p] ?? `{{${p}}}`);
			}

			return value;
		},
		[namespaces, translationsVersion]
	);

	// Set locale function
	const setLocaleFn = useCallback((newLocale: string) => {
		if (customThis.setLocale) {
			customThis.setLocale(newLocale);
		} else {
			localStorage.setItem("language", newLocale);
		}
		setLocale(newLocale);
	}, []);

	// Load translations on mount
	useEffect(() => {
		if (!autoLoad || namespaces.length === 0) {
			setReady(areNamespacesLoaded(namespaces));
			return;
		}

		let cancelled = false;

		const loadIfNeeded = async () => {
			// Esperar a que customThis.loadTranslations esté disponible (max 5s)
			let retries = 0;
			const maxRetries = 50;
			while (!customThis.loadTranslations && retries < maxRetries) {
				await new Promise((r) => setTimeout(r, 100));
				retries++;
			}

			if (cancelled) return;

			const state = customThis.__ADC_I18N__;
			const allLoaded = areNamespacesLoaded(namespaces);

			if (!allLoaded && state && customThis.loadTranslations) {
				try {
					await customThis.loadTranslations(namespaces);
				} catch (err) {
					logger.error("Error loading translations:", err);
				}
			}

			if (!cancelled) {
				setReady(areNamespacesLoaded(namespaces) || !customThis.loadTranslations);
				// Incrementar version para forzar re-cálculo de t()
				setTranslationsVersion((v) => v + 1);
			}
		};

		loadIfNeeded();

		return () => {
			cancelled = true;
		};
	}, [autoLoad, namespaces]);

	// Listen for locale changes
	useEffect(() => {
		const handleI18nLoaded = (event: Event) => {
			const detail = (event as CustomEvent).detail;
			if (detail?.locale) {
				setLocale(detail.locale);
			}

			const loaded = areNamespacesLoaded(namespaces);
			if (loaded || eventMatchesNamespaces(detail, namespaces)) {
				setReady(loaded);
				// Forzar re-cálculo de t() cuando cambian traducciones
				setTranslationsVersion((v) => v + 1);
			}
		};

		customThis.addEventListener("adc:i18n:loaded", handleI18nLoaded);
		return () => customThis.removeEventListener("adc:i18n:loaded", handleI18nLoaded);
	}, [namespaces]);

	return { t, locale, ready, setLocale: setLocaleFn };
}
