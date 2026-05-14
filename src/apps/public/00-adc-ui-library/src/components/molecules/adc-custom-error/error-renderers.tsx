/**
 * Render functions for adc-custom-error component
 */
import type { DisplayedError, ErrorSeverity } from "./types.js";

/** Maps severity level to Tailwind CSS classes */
export function getSeverityClass(severity?: ErrorSeverity): string {
	switch (severity) {
		case "warning":
			return "bg-warn text-twarn border-twarn/45";
		case "success":
			return "bg-success text-tsuccess border-tsuccess/45";
		case "error":
			return "bg-danger text-tdanger border-tdanger/45";
		default:
			return "bg-info text-tinfo border-tinfo/45";
	}
}

/** Dismiss button SVG icon */
const DismissIcon = () => (
	<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
		<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
	</svg>
);

/** Renders inline callout variant (shows only most recent error) */
export function renderCallout(errors: DisplayedError[], onDismiss: (id: number) => void) {
	if (errors.length === 0) return null;

	const error = errors[0];
	const classes = `rounded-xxl border p-3 mb-2 ${getSeverityClass(error.severity)}`;

	return (
		<div class={classes} role="alert" aria-live="assertive" aria-atomic="true">
			<div class="flex items-center justify-between gap-2">
				<span>{error.message}</span>
				<button
					type="button"
					class="opacity-70 hover:opacity-100 transition-opacity"
					onClick={() => onDismiss(error.id)}
					aria-label="Dismiss"
				>
					<DismissIcon />
				</button>
			</div>
		</div>
	);
}

/** Renders floating toast variant (shows stacked errors) */
export function renderToast(errors: DisplayedError[], onDismiss: (id: number) => void) {
	if (errors.length === 0) return null;

	return (
		<div class="fixed top-4 right-4 z-50 flex flex-col gap-2 max-w-sm">
			{errors.map((error) => {
				const classes = `rounded-xxl border p-3 shadow-lg backdrop-blur-sm animate-slide-in ${getSeverityClass(error.severity)}`;
				return (
					<div key={error.id} class={classes} role="alert" aria-live="polite">
						<div class="flex items-start justify-between gap-2">
							<span class="flex-1">{error.message}</span>
							<button
								type="button"
								class="opacity-70 hover:opacity-100 transition-opacity shrink-0"
								onClick={() => onDismiss(error.id)}
								aria-label="Dismiss"
							>
								<DismissIcon />
							</button>
						</div>
					</div>
				);
			})}
		</div>
	);
}
