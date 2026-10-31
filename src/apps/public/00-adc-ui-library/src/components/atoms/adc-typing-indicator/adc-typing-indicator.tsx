import { Component, Prop, Host } from "@stencil/core";
import { chatText } from "../../../utils/chat-i18n.js";

/** "Escribiendo…" entrante: tres puntos que rebotan (quietos con reduced-motion) y un rótulo. */
@Component({
	tag: "adc-typing-indicator",
	shadow: false,
})
export class AdcTypingIndicator {
	/** Texto junto a los puntos ("Sumi está pensando…"). Vacío = el genérico. */
	@Prop() label?: string;

	render() {
		const label = this.label || chatText("typing");
		return (
			<Host class="inline-flex items-center gap-2 text-xs text-muted" role="status" aria-live="polite">
				<span class="inline-flex items-end gap-1 rounded-xxl bg-surface px-3 py-2 shadow-cozy" aria-hidden="true">
					{[0, 150, 300].map((delay) => (
						<span
							key={delay}
							class="block h-1.5 w-1.5 rounded-full bg-muted animate-bounce motion-reduce:animate-none"
							style={{ animationDelay: `${delay}ms` }}
						/>
					))}
				</span>
				<span>{label}</span>
			</Host>
		);
	}
}
