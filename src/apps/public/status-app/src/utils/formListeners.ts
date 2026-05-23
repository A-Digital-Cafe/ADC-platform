/**
 * Helper utilities for Web Component form listeners
 * Encapsulates DOM imperative logic for form elements
 */

/**
 * Creates an event listener for input/textarea elements within Web Components
 */
export function createInputListener(element: HTMLElement | null, eventName: string, onValueChange: (value: string) => void): () => void {
	if (!element) return () => {};

	const handler = (e: Event) => {
		const target = e.target as HTMLInputElement;
		onValueChange(target.value);
	};

	element.addEventListener(eventName, handler);

	return () => {
		element.removeEventListener(eventName, handler);
	};
}
/**
 * Creates a custom event listener for Web Components
 */
export function createCustomEventListener<T>(element: HTMLElement | null, eventName: string, onValueChange: (detail: T) => void): () => void {
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
