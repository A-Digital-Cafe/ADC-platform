/**
 * Campana de notificaciones del header de plataforma.
 *
 * Vive en la UI library de núcleo pero es sólo el **botón + badge**: el menú
 * desplegable es un módulo **federado** del preset `adc-notifications`
 * (`headerMenuExpose` en el registro de apps, `./NotificationsMenu` en su
 * `config.json`), así la UI de la bandeja vive en el preset y no acá.
 *
 * Degradación:
 * - Backend caído/deshabilitado (`NotificationService`): la sonda a
 *   `/unread-count` falla y la campana **no se muestra**.
 * - App `adc-notifications` caída (su `remoteEntry.js` no carga): la campana se
 *   muestra pero al abrirla avisa con un **toast** de no disponibilidad.
 *
 * Entrega en tiempo real por SSE (`/api/notifications/stream`) con fallback a la
 * carga inicial; sincroniza el badge entre pestañas con `BroadcastChannel`.
 */
import { Component, State, Element, Listen, Host } from "@stencil/core";
import { IS_DEV, getDevUrl } from "@common/utils/url-utils.js";
import { getSession } from "../../../../utils/session.js";
import { toast } from "../../../../utils/toast.js";
import { createAdcApi } from "../../../../utils/adc-fetch.js";
import { getPlatformApp, loadPlatformRemoteModule } from "../../../../utils/platform-links.js";

type StreamEvent =
	| { type: "ready"; unread: number }
	| { type: "notification"; unread: number; notification: { title: string } }
	| { type: "read"; unread: number };

/** Contrato del menú federado: monta en el contenedor y devuelve el disposer. */
type NotificationsMenuMount = (container: HTMLElement, props: { onUnreadChange?: (unread: number) => void }) => () => void;

const api = createAdcApi({ basePath: "/api/notifications", devPort: 3000 });
const STREAM_URL = IS_DEV ? getDevUrl(3000, "/api/notifications/stream") : "/api/notifications/stream";
const SYNC_CHANNEL = "adc-notifications";
const MENU_UNAVAILABLE_MSG = "Las notificaciones no están disponibles en este momento";

@Component({
	tag: "adc-notification-bell",
	shadow: false,
})
export class AdcNotificationBell {
	@Element() el!: HTMLElement;

	/** Oculto hasta confirmar sesión + backend disponible. */
	@State() available = false;
	@State() open = false;
	@State() unread = 0;

	#source: EventSource | null = null;
	#channel: BroadcastChannel | null = null;

	/** Mount federado ya resuelto (se limpia si falló, para reintentar al próximo click). */
	#menuMountPromise: Promise<NotificationsMenuMount | null> | null = null;
	#menuMount: NotificationsMenuMount | null = null;
	#unmountMenu: (() => void) | null = null;
	#menuContainer: HTMLElement | null = null;

	async componentWillLoad(): Promise<void> {
		const session = await getSession(false, true);
		if (!session.authenticated) return;

		// Sondea el backend: si la ruta no existe (preset ausente o servicio
		// deshabilitado vía modules-manager) la campana no aparece.
		const res = await api.get<{ unread: number }>("/unread-count", { silent: true });
		if (!res.success || !res.data) return;

		this.available = true;
		this.unread = res.data.unread ?? 0;
		this.#setupSync();
		this.#connectStream();
	}

	disconnectedCallback(): void {
		this.#closeMenu();
		this.#source?.close();
		this.#source = null;
		this.#channel?.close();
		this.#channel = null;
	}

	componentDidRender(): void {
		// El contenedor del dropdown recién existe tras el render con open=true.
		if (this.open && this.#menuContainer && this.#menuMount && !this.#unmountMenu) {
			this.#unmountMenu = this.#menuMount(this.#menuContainer, {
				onUnreadChange: (unread: number) => {
					this.unread = unread;
					this.#broadcast();
				},
			});
		}
	}

	@Listen("click", { target: "document" })
	onDocumentClick(ev: MouseEvent): void {
		if (this.open && !this.el.contains(ev.target as Node)) this.#closeMenu();
	}

	// ─── Tiempo real ─────────────────────────────────────────────────────────
	#connectStream(): void {
		try {
			this.#source = new EventSource(STREAM_URL, { withCredentials: true });
			this.#source.onmessage = (e: MessageEvent) => this.#onStreamEvent(e);
			// EventSource reconecta solo; ante error persistente no rompemos la UI.
			this.#source.onerror = () => undefined;
		} catch {
			// Sin EventSource: la campana funciona con el conteo inicial.
		}
	}

	#onStreamEvent(e: MessageEvent): void {
		let ev: StreamEvent;
		try {
			ev = JSON.parse(e.data as string) as StreamEvent;
		} catch {
			return;
		}
		if (ev.type === "notification") {
			this.unread = ev.unread;
			toast.info(ev.notification.title);
			this.#broadcast();
		} else if (ev.type === "read" || ev.type === "ready") {
			this.unread = ev.unread;
		}
	}

	#setupSync(): void {
		if (typeof BroadcastChannel === "undefined") return;
		this.#channel = new BroadcastChannel(SYNC_CHANNEL);
		this.#channel.onmessage = (e: MessageEvent) => {
			const data = e.data as { unread?: number };
			if (typeof data?.unread === "number") this.unread = data.unread;
		};
	}

	#broadcast(): void {
		this.#channel?.postMessage({ unread: this.unread });
	}

	// ─── Menú federado ──────────────────────────────────────────────────────
	#loadMenuMount(): Promise<NotificationsMenuMount | null> {
		this.#menuMountPromise ??= (async () => {
			const app = getPlatformApp("notifications");
			if (!app?.headerMenuExpose) return null;
			const mount = await loadPlatformRemoteModule<NotificationsMenuMount>(app, app.headerMenuExpose);
			if (typeof mount !== "function") {
				// App offline: soltar la promesa cacheada para reintentar al próximo click.
				this.#menuMountPromise = null;
				return null;
			}
			return mount;
		})();
		return this.#menuMountPromise;
	}

	async #toggle(): Promise<void> {
		if (this.open) {
			this.#closeMenu();
			return;
		}
		this.#menuMount = await this.#loadMenuMount();
		if (!this.#menuMount) {
			toast.info(MENU_UNAVAILABLE_MSG);
			return;
		}
		this.open = true;
	}

	#closeMenu(): void {
		this.#unmountMenu?.();
		this.#unmountMenu = null;
		this.#menuContainer = null;
		this.open = false;
	}

	render() {
		if (!this.available) return null;
		const badge = this.unread > 99 ? "99+" : String(this.unread);
		return (
			<Host class="relative inline-flex">
				<button
					type="button"
					class="relative inline-flex items-center justify-center w-10 h-10 rounded-full hover:bg-black/10 transition-colors"
					aria-label="Notificaciones"
					aria-expanded={this.open ? "true" : "false"}
					onClick={() => this.#toggle()}
				>
					<svg class="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.6">
						<path
							stroke-linecap="round"
							stroke-linejoin="round"
							d="M14.857 17.082a23.848 23.848 0 0 0 5.454-1.31A8.967 8.967 0 0 1 18 9.75V9A6 6 0 0 0 6 9v.75a8.967 8.967 0 0 1-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m6.714 0a3 3 0 1 1-6.714 0m6.714 0a24.255 24.255 0 0 1-6.714 0"
						/>
					</svg>
					{this.unread > 0 && (
						<span class="absolute -top-0.5 -right-0.5 min-w-4.5 h-4.5 px-1 flex items-center justify-center text-[10px] font-bold leading-none text-white bg-red-600 rounded-full">
							{badge}
						</span>
					)}
				</button>

				{this.open && <div class="absolute right-0 top-full mt-2 z-50" ref={(el) => (this.#menuContainer = el ?? null)}></div>}
			</Host>
		);
	}
}
