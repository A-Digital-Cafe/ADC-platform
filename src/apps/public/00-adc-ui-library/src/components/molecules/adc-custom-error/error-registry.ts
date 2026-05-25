/**
 * Registry for tracking which error keys have dedicated (non-global) handlers.
 * This prevents global handlers from duplicating errors that specific handlers will display.
 */

import type { ErrorKeyConfig } from "./types.js";

/** Set of error keys claimed by specific handlers */
const claimedErrorKeys = new Set<string>();

/**
 * Registers error keys that a specific (non-global) handler will handle.
 * Called when handlers with specific keys connect to the DOM.
 */
export function registerClaimedKeys(keys: ErrorKeyConfig[]): void {
	keys.forEach((k) => claimedErrorKeys.add(k.key));
}

/**
 * Recalculates claimed keys from all handlers currently in the DOM.
 * Called when a specific handler disconnects to handle multiple handlers for same key.
 */
export function recalculateClaimedKeys(): void {
	claimedErrorKeys.clear();
	const handlers = document.querySelectorAll("adc-custom-error:not([global])");
	handlers.forEach((handler) => {
		const keysAttr = handler.getAttribute("keys");
		if (keysAttr) {
			try {
				const parsed = JSON.parse(keysAttr);
				if (Array.isArray(parsed)) {
					parsed.forEach((k: string | ErrorKeyConfig) => {
						claimedErrorKeys.add(typeof k === "string" ? k : k.key);
					});
				}
			} catch {
				// Invalid JSON, skip
			}
		}
	});
}
