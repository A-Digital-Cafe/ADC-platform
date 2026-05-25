/**
 * Error handling utilities for ADC Platform
 *
 * Use showError() to dispatch errors to adc-custom-error components.
 * Errors are routed based on errorKey and component configuration.
 */

type ErrorSeverity = "info" | "warning" | "error" | "success";

export interface ShowErrorOptions {
	/** The error key (e.g., "INVALID_CREDENTIALS", "PATH_NOT_FOUND") */
	errorKey: string;
	/** Human-readable error message */
	message: string;
	/** Error severity level */
	severity?: ErrorSeverity;
	/** Additional error data */
	data?: Record<string, unknown>;
}

/**
 * Dispatch an error to be handled by adc-custom-error components.
 *
 * @example
 * ```ts
 * import { showError } from "@adc-ui-library/utils/error-handler";
 *
 * // Simple error
 * showError({ errorKey: "INVALID_CREDENTIALS", message: "Invalid credentials" });
 *
 * // With severity
 * showError({
 *   errorKey: "ACCOUNT_BLOCKED",
 *   message: "Account blocked",
 *   severity: "warning",
 *   data: { blockedUntil: "2024-01-15" }
 * });
 * ```
 */
export function showError(options: ShowErrorOptions): void {
	const event = new CustomEvent("adc-error", {
		detail: {
			errorKey: options.errorKey,
			message: options.message,
			severity: options.severity || "error",
			data: options.data,
		},
		bubbles: true,
		composed: true,
	});
	globalThis.dispatchEvent(event);
}

/**
 * Clear all displayed errors by dispatching a clear event.
 * Useful when navigating away or resetting forms.
 */
export function clearErrors(): void {
	const event = new CustomEvent("adc-error-clear", {
		bubbles: true,
		composed: true,
	});
	globalThis.dispatchEvent(event);
}
