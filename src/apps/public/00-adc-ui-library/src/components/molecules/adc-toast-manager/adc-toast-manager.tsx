/**
 * Toast manager component that handles global toast notifications.
 * Listens for 'adc-toast' custom events and displays them using inline rendered items.
 *
 * Usage in layout:
 * <adc-toast-manager></adc-toast-manager>
 *
 * Dispatch from anywhere:
 * globalThis.dispatchEvent(new CustomEvent('adc-toast', {
 *   detail: {
 *     message: 'Success!',
 *     variant: 'success',
 *     duration: 3000
 *   }
 * }));
 */

import { Component, State, Element } from "@stencil/core";
import type { ADCToastEvent, DisplayedToast } from "./types.js";
import { renderToastItem } from "./adc-toast-item.js";

@Component({
	tag: "adc-toast-manager",
	shadow: false,
})
export class AdcToastManager {
	@Element() el!: HTMLElement;

	@State() toasts: DisplayedToast[] = [];

	private toastIdCounter = 0;
	private readonly boundHandleToast = this.handleToast.bind(this);
	private readonly boundHandleClear = this.handleClear.bind(this);

	connectedCallback() {
		globalThis.addEventListener("adc-toast", this.boundHandleToast as EventListener);
		globalThis.addEventListener("adc-toast-clear", this.boundHandleClear);
	}

	disconnectedCallback() {
		globalThis.removeEventListener("adc-toast", this.boundHandleToast as EventListener);
		globalThis.removeEventListener("adc-toast-clear", this.boundHandleClear);
		this.toasts.forEach((toast) => toast.timeout && clearTimeout(toast.timeout));
	}

	private handleClear() {
		this.toasts.forEach((toast) => toast.timeout && clearTimeout(toast.timeout));
		this.toasts = [];
	}

	private handleToast(event: CustomEvent<ADCToastEvent>) {
		const toastData = event.detail;
		if (!toastData?.message) return;

		const toastEntry: DisplayedToast = {
			...toastData,
			variant: toastData.variant || "info",
			duration: toastData.duration ?? 3000,
			id: ++this.toastIdCounter,
		};

		const duration = toastEntry.duration ?? 3000;

		if (duration > 0) {
			toastEntry.timeout = setTimeout(() => this.dismissToast(toastEntry.id), duration);
		}

		this.toasts = [toastEntry, ...this.toasts];
	}

	private dismissToast(id: number) {
		const toast = this.toasts.find((t) => t.id === id);
		if (toast?.timeout) clearTimeout(toast.timeout);
		this.toasts = this.toasts.filter((t) => t.id !== id);
	}

	render() {
		return (
			<div class="fixed top-6 right-6 z-50 flex flex-col gap-3 pointer-events-none">
				{this.toasts.map((toast) => (
					<div key={toast.id} class="pointer-events-auto">
						{renderToastItem(toast, (id) => this.dismissToast(id))}
					</div>
				))}
			</div>
		);
	}
}
