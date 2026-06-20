/**
 * Types and interfaces for adc-toast-manager component
 */

type ToastVariant = "success" | "error" | "warning" | "info";

export interface ADCToastEvent {
	message: string;
	variant?: ToastVariant;
	duration?: number;
	key?: string; // Optional key to identify toast group
}

export interface DisplayedToast extends ADCToastEvent {
	id: number;
	count: number;
	timeout?: ReturnType<typeof setTimeout>;
}
