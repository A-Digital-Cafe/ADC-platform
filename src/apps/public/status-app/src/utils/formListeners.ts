/**
 * Helper utilities for Web Component form listeners
 * Encapsulates DOM imperative logic for form elements
 */

/**
 * Creates an event listener for input/textarea elements within Web Components
 */
export function createInputListener(
	element: HTMLElement | null,
	selector: "input" | "textarea",
	onValueChange: (value: string) => void
): () => void {
	if (!element) return () => {};

	// Get the actual input/textarea element
	const target = element.querySelector(selector) as HTMLInputElement | HTMLTextAreaElement | null;
	if (!target) {
		console.warn(`[formListeners] Element not found with selector: ${selector}`);
		return () => {};
	}

	const handler = (e: Event) => {
		const value = (e.target as HTMLInputElement | HTMLTextAreaElement).value;
		onValueChange(value);
	};

	target.addEventListener("input", handler);

	// Return cleanup function
	return () => {
		target.removeEventListener("input", handler);
	};
}

/**
 * Creates a custom event listener for Web Components
 */
export function createCustomEventListener<T>(
	element: HTMLElement | null,
	eventName: string,
	onValueChange: (detail: T) => void
): () => void {
	if (!element) return () => {};

	const handler = (e: CustomEvent<T>) => {
		if (e.detail !== undefined && e.detail !== null) {
			onValueChange(e.detail);
		}
	};

	element.addEventListener(eventName, handler as EventListener);

	// Return cleanup function
	return () => {
		element.removeEventListener(eventName, handler as EventListener);
	};
}
