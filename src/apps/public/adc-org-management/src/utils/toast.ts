type ToastVariant = "success" | "error" | "info" | "warning";

function showToast(message: string, variant: ToastVariant = "info", duration = 3000) {
	globalThis.dispatchEvent(
		new CustomEvent("adc-toast", {
			detail: {
				message,
				variant,
				duration,
			},
		})
	);
}

export const toast = {
	success: (msg: string) => showToast(msg, "success"),
	error: (msg: string) => showToast(msg, "error"),
	info: (msg: string) => showToast(msg, "info"),
	warning: (msg: string) => showToast(msg, "warning"),
};
