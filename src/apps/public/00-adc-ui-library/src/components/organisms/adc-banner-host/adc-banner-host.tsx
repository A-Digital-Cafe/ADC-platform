import { Component, Prop, State, Host } from "@stencil/core";
import { loadPlatformState, type PlatformBanner } from "@common/utils/module-availability.js";

/**
 * Barra de avisos bajo el header. Muestra banners globales siempre y los de app cuando
 * coinciden con la app actual (`app` prop o `window.__ADC_APP__`). Programa el mostrado/
 * ocultado con timers según `from`/`until` (sin polling).
 */
@Component({
	tag: "adc-banner-host",
	shadow: false,
})
export class AdcBannerHost {
	/** App actual (nombre base) para filtrar banners de app; si vacío usa `window.__ADC_APP__`. */
	@Prop() app: string = "";

	@State() banners: PlatformBanner[] = [];
	@State() dismissed: string[] = [];
	/** Cambia en cada límite `from`/`until` para forzar re-render. */
	@State() now: number = Date.now();

	private timers: ReturnType<typeof setTimeout>[] = [];

	async componentWillLoad() {
		const { banners } = await loadPlatformState();
		this.banners = this.relevant(banners);
		this.scheduleBoundaries();
	}

	disconnectedCallback() {
		this.timers.forEach((t) => clearTimeout(t));
		this.timers = [];
	}

	private currentApp(): string {
		return this.app || (globalThis as { __ADC_APP__?: string }).__ADC_APP__ || "";
	}

	private relevant(all: PlatformBanner[]): PlatformBanner[] {
		const app = this.currentApp();
		return all.filter((b) => b.scope === "global" || (b.scope === "app" && !!b.appName && b.appName === app));
	}

	/** Re-render en cada `from`/`until` futuro: mostrar/ocultar a tiempo sin polling. */
	private scheduleBoundaries() {
		const now = Date.now();
		const bump = () => (this.now = Date.now());
		for (const b of this.banners) {
			const from = b.from ? new Date(b.from).getTime() : 0;
			const until = b.until ? new Date(b.until).getTime() : 0;
			if (from > now) this.timers.push(setTimeout(bump, from - now + 100));
			if (until > now) this.timers.push(setTimeout(bump, until - now + 100));
		}
	}

	private visible(): PlatformBanner[] {
		const now = this.now;
		return this.banners.filter((b) => {
			if (this.dismissed.includes(b.bannerId)) return false;
			const from = b.from ? new Date(b.from).getTime() : 0;
			const until = b.until ? new Date(b.until).getTime() : Number.POSITIVE_INFINITY;
			return from <= now && now < until;
		});
	}

	private toneClass(type: PlatformBanner["type"]): string {
		switch (type) {
			case "danger":
				return "bg-danger text-tdanger border-tdanger/50";
			case "success":
				return "bg-success text-tsuccess border-tsuccess/50";
			default:
				return "bg-warn text-twarn border-twarn/50";
		}
	}

	private readonly dismiss = (id: string) => {
		this.dismissed = [...this.dismissed, id];
	};

	render() {
		const items = this.visible();
		if (items.length === 0) return null;
		return (
			<Host>
				<div class="flex flex-col gap-1 py-1" role="status" aria-live="polite">
					{items.map((b) => (
						<div
							key={b.bannerId}
							class={`flex border items-center justify-between rounded-xxl gap-4 pr-4 pl-8 py-2 text-sm font-semibold ${this.toneClass(b.type)}`}
						>
							<span>{b.message}</span>
							<button
								type="button"
								class="shrink-0 opacity-70 hover:opacity-100 min-h-8 min-w-8 touch-manipulation"
								aria-label="Descartar aviso"
								onClick={() => this.dismiss(b.bannerId)}
							>
								✕
							</button>
						</div>
					))}
				</div>
			</Host>
		);
	}
}
