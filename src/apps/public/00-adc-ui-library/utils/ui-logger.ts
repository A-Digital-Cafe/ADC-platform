/**
 * Logger ligero para apps UI (U-04). Sustituye `console.*` directos.
 *
 * - En producción solo emite `warn`/`error` (el resto se silencia).
 * - Prefijo consistente por módulo para filtrar en DevTools.
 * - `localStorage.setItem("adc:debug", "1")` reactiva debug/info en producción.
 */

import { IS_DEV } from "@common/utils/url-utils.js";

type Level = "debug" | "info" | "warn" | "error";

const LEVEL_WEIGHT: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };

function minLevel(): number {
	try {
		if (globalThis.localStorage?.getItem("adc:debug") === "1") return LEVEL_WEIGHT.debug;
	} catch {
		/* sin storage */
	}
	return IS_DEV ? LEVEL_WEIGHT.debug : LEVEL_WEIGHT.warn;
}

function emit(level: Level, prefix: string, args: unknown[]): void {
	if (LEVEL_WEIGHT[level] < minLevel()) return;
	console[level === "debug" ? "log" : level](`[${prefix}]`, ...args);
}

export interface UiLogger {
	debug: (...args: unknown[]) => void;
	info: (...args: unknown[]) => void;
	warn: (...args: unknown[]) => void;
	error: (...args: unknown[]) => void;
}

/** Crea un logger con prefijo de módulo (ej. `createUiLogger("i18n-react")`). */
export function createUiLogger(prefix: string): UiLogger {
	return {
		debug: (...args) => emit("debug", prefix, args),
		info: (...args) => emit("info", prefix, args),
		warn: (...args) => emit("warn", prefix, args),
		error: (...args) => emit("error", prefix, args),
	};
}
