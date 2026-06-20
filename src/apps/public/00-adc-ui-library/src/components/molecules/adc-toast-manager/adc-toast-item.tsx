import type { DisplayedToast } from "./types.js";

function getVariantClass(variant?: string): string {
	switch (variant) {
		case "warning":
			return "bg-warn text-twarn border border-twarn/45";
		case "success":
			return "bg-success text-tsuccess border border-tsuccess/45";
		case "error":
			return "bg-danger text-tdanger border border-tdanger/45";
		default:
			return "bg-info text-tinfo border border-tinfo/45";
	}
}

export function renderToastItem(toast: DisplayedToast, onDismiss: (id: number) => void) {
	const styles = getVariantClass(toast.variant);

	return (
		<div
			class={`min-w-55 max-w-87.5 px-6 py-4 rounded-xl shadow-lg flex items-center text-base font-medium gap-4 transition-all animate-in fade-in slide-in-from-top-4 ${styles}`}
			role="status"
		>
			<span>{toast.message}</span>

			{toast.count > 1 && (
				<span class="shrink-0 rounded-full bg-black/15 px-2 py-0.5 text-sm font-bold tabular-nums" aria-label={`×${toast.count}`}>
					×{toast.count}
				</span>
			)}

			<button
				class="ml-auto opacity-80 hover:opacity-100 transition-opacity text-xl font-bold"
				onClick={() => onDismiss(toast.id)}
				aria-label="Cerrar notificación"
			>
				×
			</button>
		</div>
	);
}
