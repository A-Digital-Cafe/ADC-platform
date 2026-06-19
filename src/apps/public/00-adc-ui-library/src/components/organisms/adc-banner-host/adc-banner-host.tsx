import { Component, Prop, State, Host } from "@stencil/core";
import { isPrivateHost } from "../../../utils/url.js";

interface BannerData {
	bannerId: string;
	scope: "app" | "global";
	appName?: string | null;
	message: string;
	type: "warn" | "danger" | "success";
	from?: string | null;
	until?: string | null;
}

interface PlatformState {
	disabled?: Record<string, unknown>;
	banners?: BannerData[];
}

interface PlatformWindow {
	__ADC_PLATFORM__?: PlatformState;
	__ADC_PLATFORM_PROMISE__?: Promise<PlatformState>;
}

function platformWindow(): PlatformWindow {
	return globalThis as unknown as PlatformWindow;
}

/**
 * Carga el estado de plataforma una sola vez por página, compartido vía `window` con
 * el gate de mantenimiento (`@common/utils/module-availability`): en prod lo inyecta el
 * kernel (`window.__ADC_PLATFORM__`, CERO fetch); en dev se pide UNA vez a
 * `/api/modules/platform` (cacheable) y se reutiliza la misma promesa. Así agregar
 * banners al header NO genera una petición por render.
 */
function loadBanners(apiBaseUrl: string): Promise<BannerData[]> {
	const win = platformWindow();
	if (win.__ADC_PLATFORM__) return Promise.resolve(win.__ADC_PLATFORM__.banners ?? []);
	if (win.__ADC_PLATFORM_PROMISE__) return win.__ADC_PLATFORM_PROMISE__.then((s) => s?.banners ?? []);
	const p: Promise<PlatformState> = fetch(`${apiBaseUrl}/api/modules/platform`, { credentials: "include" })
		.then((r) => (r.ok ? r.json() : null))
		.then((d) => {
			const state: PlatformState = { disabled: d?.disabled ?? {}, banners: Array.isArray(d?.banners) ? d.banners : [] };
			win.__ADC_PLATFORM__ = state;
			return state;
		})
		.catch(() => ({ disabled: {}, banners: [] }));
	win.__ADC_PLATFORM_PROMISE__ = p;
	return p.then((s) => s.banners ?? []);
}

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
	@Prop() apiBaseUrl: string = isPrivateHost(globalThis.location?.hostname ?? "")
		? `${globalThis.location?.protocol}//${globalThis.location?.hostname}:3000`
		: "";

	/** App actual (nombre base) para filtrar banners de app; si vacío usa `window.__ADC_APP__`. */
	@Prop() app: string = "";

	@State() banners: BannerData[] = [];
	@State() dismissed: string[] = [];
	/** Cambia en cada límite `from`/`until` para forzar re-render. */
	@State() now: number = Date.now();

	private timers: ReturnType<typeof setTimeout>[] = [];

	async componentWillLoad() {
		const all = await loadBanners(this.apiBaseUrl);
		this.banners = this.relevant(all);
		this.scheduleBoundaries();
	}

	disconnectedCallback() {
		this.timers.forEach((t) => clearTimeout(t));
		this.timers = [];
	}

	private currentApp(): string {
		return this.app || (globalThis as { __ADC_APP__?: string }).__ADC_APP__ || "";
	}

	private relevant(all: BannerData[]): BannerData[] {
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

	private visible(): BannerData[] {
		const now = this.now;
		return this.banners.filter((b) => {
			if (this.dismissed.includes(b.bannerId)) return false;
			const from = b.from ? new Date(b.from).getTime() : 0;
			const until = b.until ? new Date(b.until).getTime() : Number.POSITIVE_INFINITY;
			return from <= now && now < until;
		});
	}

	private toneClass(type: BannerData["type"]): string {
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
