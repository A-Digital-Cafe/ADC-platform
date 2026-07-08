/**
 * Campana de notificaciones del header de plataforma.
 *
 * Vive en la UI library de núcleo y se **auto-oculta** si el backend de
 * notificaciones (preset `adc-notifications` / `NotificationService`) no responde.
 * Entrega en tiempo real por SSE (`/api/notifications/stream`) con fallback a la
 * carga inicial; sincroniza el badge entre pestañas con `BroadcastChannel`.
 */
import { Component, State, Element, Listen, Host } from "@stencil/core";
import { IS_DEV, getDevUrl } from "@common/utils/url-utils.js";
import { getSession } from "../../../../utils/session.js";
import { toast } from "../../../../utils/toast.js";
import { createAdcApi } from "../../../../utils/adc-fetch.js";
import { resolvePlatformPath } from "../../../../utils/platform-links.js";

interface BellNotification {
	id: string;
	topic: string;
	title: string;
	body: string;
	icon?: string | null;
	link?: string | null;
	/** Si está, `link` es una ruta a resolver según entorno (dev port / prod subdominio). */
	linkApp?: string | null;
	readAt?: string | null;
	createdAt: string;
}

/** URL final del enlace de una notificación: ruta de app resuelta o URL absoluta. */
function notificationHref(n: BellNotification): string | null {
	if (!n.link) return null;
	if (n.linkApp) return resolvePlatformPath(n.linkApp, n.link) ?? n.link;
	return n.link;
}

type StreamEvent =
	| { type: "ready"; unread: number }
	| { type: "notification"; unread: number; notification: BellNotification }
	| { type: "read"; unread: number };

const api = createAdcApi({ basePath: "/api/notifications", devPort: 3000 });
const STREAM_URL = IS_DEV ? getDevUrl(3000, "/api/notifications/stream") : "/api/notifications/stream";
const SYNC_CHANNEL = "adc-notifications";

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
	@State() items: BellNotification[] = [];
	@State() loadingList = false;

	#source: EventSource | null = null;
	#channel: BroadcastChannel | null = null;

	async componentWillLoad(): Promise<void> {
		const session = await getSession(false, true);
		if (!session.authenticated) return;

		// Sondea el backend: si la ruta no existe (preset ausente) la campana no aparece.
		const res = await api.get<{ unread: number }>("/unread-count", { silent: true });
		if (!res.success || !res.data) return;

		this.available = true;
		this.unread = res.data.unread ?? 0;
		this.#setupSync();
		this.#connectStream();
	}

	disconnectedCallback(): void {
		this.#source?.close();
		this.#source = null;
		this.#channel?.close();
		this.#channel = null;
	}

	@Listen("click", { target: "document" })
	onDocumentClick(ev: MouseEvent): void {
		if (this.open && !this.el.contains(ev.target as Node)) this.open = false;
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
			this.items = [ev.notification, ...this.items].slice(0, 50);
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

	// ─── Acciones ──────────────────────────────────────────────────────────────
	async #toggle(): Promise<void> {
		this.open = !this.open;
		if (this.open) await this.#loadList();
	}

	async #loadList(): Promise<void> {
		this.loadingList = true;
		const res = await api.get<{ notifications: BellNotification[]; unread: number }>("", { silent: true });
		if (res.success && res.data) {
			this.items = res.data.notifications;
			this.unread = res.data.unread;
		}
		this.loadingList = false;
	}

	async #onItemClick(item: BellNotification): Promise<void> {
		if (!item.readAt) {
			const res = await api.post<{ unread: number }>(`/${item.id}/read`, { silent: true });
			// Reflejar la lectura sólo si el server la persistió (si no, reaparece al recargar).
			if (res.success && res.data) {
				this.unread = res.data.unread;
				this.items = this.items.map((n) => (n.id === item.id ? { ...n, readAt: new Date().toISOString() } : n));
				this.#broadcast();
			}
		}
		const href = notificationHref(item);
		if (href) globalThis.location.href = href;
	}

	async #markAllRead(): Promise<void> {
		const res = await api.post<{ unread: number }>("/read-all", { silent: true });
		if (res.success) {
			this.unread = 0;
			this.items = this.items.map((n) => (n.readAt ? n : { ...n, readAt: new Date().toISOString() }));
			this.#broadcast();
		}
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

				{this.open && (
					<div class="absolute right-0 top-full mt-2 w-80 max-w-[calc(100vw-1.5rem)] max-h-112 overflow-hidden rounded-xl bg-surface text-tsurface shadow-cozy ring-1 ring-black/5 z-50 flex flex-col">
						<div class="flex items-center justify-between px-4 py-2.5 border-b border-black/10">
							<span class="font-bold text-sm">Notificaciones</span>
							{this.unread > 0 && (
								<button type="button" class="text-xs text-accent hover:underline" onClick={() => this.#markAllRead()}>
									Marcar todas como leídas
								</button>
							)}
						</div>
						<div class="overflow-y-auto">
							{this.loadingList && <div class="px-4 py-6 text-center text-sm opacity-60">Cargando…</div>}
							{!this.loadingList && this.items.length === 0 && (
								<div class="px-4 py-8 text-center text-sm opacity-60">No tenés notificaciones</div>
							)}
							{!this.loadingList &&
								this.items.map((n) => (
									<button
										key={n.id}
										type="button"
										class={`w-full text-left px-4 py-3 border-b border-black/5 hover:bg-black/5 transition-colors ${
											n.readAt ? "opacity-60" : ""
										}`}
										onClick={() => this.#onItemClick(n)}
									>
										<div class="flex items-start gap-2">
											{!n.readAt && <span class="mt-1.5 w-2 h-2 rounded-full bg-accent shrink-0" />}
											<span class="flex-1 min-w-0">
												<span class="block font-semibold text-sm truncate">{n.title}</span>
												{n.body && <span class="block text-xs opacity-70 line-clamp-2">{n.body}</span>}
											</span>
										</div>
									</button>
								))}
						</div>
						<a
							href={resolvePlatformPath("notifications", "/") ?? "#"}
							class="block px-4 py-2.5 text-center text-xs font-semibold text-accent border-t border-black/10 hover:bg-black/5"
						>
							Ver todas las notificaciones
						</a>
					</div>
				)}
			</Host>
		);
	}
}
