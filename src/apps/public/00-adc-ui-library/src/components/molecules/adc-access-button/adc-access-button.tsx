import { Component, Prop, State, h, Event, EventEmitter, Listen, Element } from "@stencil/core";
import { isPrivateHost } from "../../../utils/url.js";
import { broadcastAuthChange, forceLogoutAndRefresh, getStoredAuthUser, setStoredAuthUser, setupAuthSync } from "../../../../utils/auth-sync.js";
import { appendCsrfHeader } from "../../../../utils/csrf.js";
import { buildAvatarUrl } from "../../../../utils/avatar.js";
import type { SessionUser, SessionResponse } from "@common/types/identity/Session.js";

interface OrgOption {
	orgId: string;
	slug: string;
}

export interface AccessMenuItem {
	label: string;
	href: string;
	icon?: string;
}

/**
 * Botón de acceso que muestra:
 * - Si logueado: avatar + dropdown con menú de items + logout
 * - Si no logueado: botón "Ingresar" que redirige a auth
 */
@Component({
	tag: "adc-access-button",
	shadow: false,
})
export class AdcAccessButton {
	/** URL base del auth (en dev: localhost:3012, en prod: auth.adigitalcafe.com) */
	@Prop() authUrl: string =
		`${globalThis.location?.protocol}//auth.adigitalcafe.com${globalThis.location?.port ? `:${globalThis.location?.port}` : ""}`;

	/** URL base de la API (en dev: http://hostname:3000, en prod: vacío para usar relativo) */
	@Prop() apiBaseUrl: string = isPrivateHost(globalThis.location?.hostname ?? "")
		? `${globalThis.location?.protocol}//${globalThis.location?.hostname}:3000`
		: "";

	/** URL de la API de sesión */
	@Prop() sessionApiUrl: string = "/api/auth/session";

	/** URL de logout */
	@Prop() logoutApiUrl: string = "/api/auth/logout";

	/** Texto del botón de mi cuenta */
	@Prop() accountText: string = "Mi cuenta";

	/** URL del botón de mi cuenta */
	@Prop() accountUrl: string = "";

	@Prop() redirectAfterLogin: boolean = true;

	/** Texto del botón cuando no está logueado */
	@Prop() loginText: string = "Ingresar";

	/** Texto del botón de logout */
	@Prop() logoutText: string = "Cerrar sesión";

	/** Texto para cambiar de organización */
	@Prop() switchOrgText: string = "Cambiar acceso";

	/** Texto para acceso personal (sin org) */
	@Prop() personalAccessText: string = "Acceso personal";

	/** Items del menú dropdown (array de {label, href, icon?}) */
	@Prop() menuItems: AccessMenuItem[] = [];

	/** Estado de autenticación */
	@State() isAuthenticated: boolean = false;

	/** Datos del usuario */
	@State() user: SessionUser | null = null;

	/** Estado de carga */
	@State() loading: boolean = true;

	/** Dropdown abierto */
	@State() dropdownOpen: boolean = false;

	/** Panel de switch de org abierto */
	@State() orgSwitcherOpen: boolean = false;

	/** Organizaciones del usuario */
	@State() userOrgs: OrgOption[] = [];

	/** Cargando orgs */
	@State() loadingOrgs: boolean = false;

	@Element() el!: HTMLElement;

	/** Evento emitido al cerrar sesión */
	@Event() adcLogout!: EventEmitter<void>;

	/** Evento emitido al hacer login */
	@Event() adcLoginClick!: EventEmitter<void>;

	/** Evento emitido al cambiar de organización */
	@Event() adcOrgSwitch!: EventEmitter<string | undefined>;

	private hoverTimeout?: ReturnType<typeof setTimeout>;

	/** Limpieza de sincronización login/logout entre pestañas */
	private teardownAuthSync?: () => void;

	@Listen("mouseenter")
	@Listen("focusin")
	handleOpen() {
		if (!this.isAuthenticated) return;
		if (this.hoverTimeout) clearTimeout(this.hoverTimeout);
		this.dropdownOpen = true;
	}

	@Listen("mouseleave")
	handleMouseLeave() {
		if (!this.isAuthenticated) return;
		this.hoverTimeout = setTimeout(() => {
			this.dropdownOpen = false;
		}, 150);
	}

	@Listen("focusout")
	handleFocusOut(event: FocusEvent) {
		if (!this.isAuthenticated) return;
		const relatedTarget = event.relatedTarget as HTMLElement | null;
		if (relatedTarget && this.el.contains(relatedTarget)) return;
		this.hoverTimeout = setTimeout(() => {
			this.dropdownOpen = false;
		}, 150);
	}

	@Listen("keydown")
	handleKeyDown(event: KeyboardEvent) {
		if (event.key === "Escape") {
			this.dropdownOpen = false;
		}
	}

	componentWillLoad() {
		this.checkSession();
		this.teardownAuthSync = setupAuthSync(() => {
			globalThis.location?.reload();
		});
	}

	disconnectedCallback() {
		if (this.hoverTimeout) clearTimeout(this.hoverTimeout);
		this.teardownAuthSync?.();
		this.teardownAuthSync = undefined;
	}

	/** Construye URL completa para la API */
	private getApiUrl(path: string): string {
		return `${this.apiBaseUrl}${path}`;
	}

	private getDefaultAccountUrl(): string {
		return isPrivateHost(globalThis.location?.hostname ?? "") ? "http://localhost:3016" : "https://my-account.adigitalcafe.com";
	}

	private async checkSession() {
		let authenticatedUserId: string | null = null;
		try {
			const response = await fetch(this.getApiUrl(this.sessionApiUrl), {
				method: "GET",
				credentials: "include",
			});

			// Si no hay sesión (401) o hay error, marcar como no autenticado
			if (!response.ok) {
				this.isAuthenticated = false;
				this.user = null;
				return;
			}

			const data: SessionResponse = await response.json();

			this.isAuthenticated = data.authenticated;
			this.user = data.user || null;
			if (data.authenticated && data.user?.id) {
				authenticatedUserId = data.user.id;
			}
		} catch {
			this.isAuthenticated = false;
			this.user = null;
		} finally {
			this.loading = false;
			this.syncLoginState(authenticatedUserId);
		}
	}

	/**
	 * Sincroniza el estado de login entre pestañas.
	 * Sólo hace broadcast cuando detecta una transición real (usuario distinto al último conocido),
	 * evitando spam de mensajes y recargas cruzadas por cada re-render.
	 */
	private syncLoginState(currentUserId: string | null) {
		const previousUserId = getStoredAuthUser();
		if (currentUserId === previousUserId) return;

		setStoredAuthUser(currentUserId);

		// Sólo notificamos cuando efectivamente hay un login nuevo aquí.
		// (El logout ya emite su propio broadcast en handleLogout).
		if (currentUserId && previousUserId !== currentUserId) {
			broadcastAuthChange("login");
		}
	}

	private readonly handleLoginClick = () => {
		this.adcLoginClick.emit();
		if (!globalThis.location) return;
		const params = new URLSearchParams();
		params.set("returnUrl", globalThis.location.origin + globalThis.location.pathname);
		globalThis.location.href = `${this.authUrl}/login?${params.toString()}`;
	};

	private readonly handleLogout = async () => {
		this.isAuthenticated = false;
		this.user = null;
		this.dropdownOpen = false;
		this.adcLogout.emit();
		await forceLogoutAndRefresh(this.getApiUrl(this.logoutApiUrl));
	};

	private readonly handleOpenOrgSwitcher = async () => {
		this.orgSwitcherOpen = true;
		this.loadingOrgs = true;

		try {
			const response = await fetch(this.getApiUrl("/api/auth/user-orgs"), {
				method: "GET",
				credentials: "include",
			});

			if (response.ok) {
				const data = await response.json();
				this.userOrgs = data.orgs || [];
			}
		} catch {
			this.userOrgs = [];
		} finally {
			this.loadingOrgs = false;
		}
	};

	private readonly handleSwitchOrg = async (orgId?: string) => {
		try {
			const url = this.getApiUrl("/api/auth/switch-org");
			const headers = await appendCsrfHeader("POST", url, { "Content-Type": "application/json" }, "include");
			const response = await fetch(url, {
				method: "POST",
				credentials: "include",
				headers,
				body: JSON.stringify({ orgId }),
			});

			if (response.ok) {
				this.orgSwitcherOpen = false;
				this.dropdownOpen = false;
				this.adcOrgSwitch.emit(orgId);
				// Recargar la página para aplicar el nuevo contexto
				globalThis.location?.reload();
			}
		} catch {
			// Silently fail
		}
	};

	private readonly handleToggle = () => {
		this.dropdownOpen = !this.dropdownOpen;
	};

	/**
	 * Resuelve la URL del avatar usando la sesión (que ya combina perfil/metadata/
	 * linkedAccounts en el backend) con fallback determinista a DiceBear.
	 */
	private getAvatarUrl(): string {
		return buildAvatarUrl({
			avatar: this.user?.avatar ?? null,
			seed: this.user?.id || this.user?.username || "default",
		});
	}

	render() {
		void h;
		if (this.loading) {
			return (
				<div class="w-12 h-12 rounded-full bg-muted animate-pulse" aria-live="polite" role="status">
					<span class="sr-only">Cargando sesión</span>
				</div>
			);
		}

		// No autenticado - mostrar botón de login
		if (!this.isAuthenticated) {
			return (
				<button
					type="button"
					onClick={this.handleLoginClick}
					class="flex items-center gap-2 px-3 py-2 hover:underline transition-colors cursor-pointer min-h-11 touch-manipulation"
				>
					{/* User icon */}
					<svg class="w-6 h-6" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24" aria-hidden="true">
						<path
							stroke-linecap="round"
							stroke-linejoin="round"
							d="M15.75 6a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0ZM4.501 20.118a7.5 7.5 0 0 1 14.998 0A17.933 17.933 0 0 1 12 21.75c-2.676 0-5.216-.584-7.499-1.632Z"
						/>
					</svg>
					<span>{this.loginText}</span>
				</button>
			);
		}

		// Autenticado - mostrar avatar con dropdown
		return (
			<div class="relative inline-block">
				<button
					type="button"
					class="flex items-center gap-2 p-1 rounded-full hover:bg-accent/10 transition-all cursor-pointer"
					aria-haspopup="menu"
					aria-expanded={this.dropdownOpen ? "true" : "false"}
					onClick={this.handleToggle}
				>
					{/* Header del dropdown con info del usuario */}
					<div class="pl-4 pr-2 text-right">
						<p class="font-semibold truncate">{this.user?.username}</p>
						{this.user?.orgId && <p class="text-xs text-muted truncate">{this.user.orgSlug || this.user.orgId}</p>}
					</div>
					<img
						src={this.getAvatarUrl()}
						alt={`Avatar de ${this.user?.username || "usuario"}`}
						class="w-12 h-12 rounded-full border-2 border-accent object-cover"
						width="40"
						height="40"
					/>
					<svg
						class={`w-4 h-4 transition-transform ${this.dropdownOpen ? "rotate-180" : ""}`}
						fill="none"
						stroke="currentColor"
						viewBox="0 0 24 24"
						aria-hidden="true"
					>
						<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
					</svg>
				</button>

				{this.dropdownOpen && (
					<div
						class="absolute right-0 top-full mt-2 w-64 rounded-lg shadow-lg z-50 bg-surface text-tsurface overflow-hidden font-semibold"
						role="menu"
						aria-orientation="vertical"
					>
						{/* Items del menú */}
						{this.menuItems.length > 0 && (
							<div class="py-1">
								{this.menuItems.map((item, idx) => (
									<a
										href={item.href}
										key={`adc-access-button-item-${item.href}-${idx}`}
										class="flex items-center gap-2 px-4 py-2 hover:bg-accent text-text transition-colors"
										role="menuitem"
									>
										{item.icon && <span class="w-5 h-5 flex items-center justify-center" innerHTML={item.icon}></span>}
										{item.label}
									</a>
								))}
							</div>
						)}

						{/* Switch de organización */}
						<div class="border-t border-divider">
							{!this.orgSwitcherOpen ? (
								<button
									type="button"
									class="flex w-full items-center gap-2 px-4 py-3 text-left hover:bg-accent/10 text-text hover:cursor-pointer transition-colors"
									role="menuitem"
									onClick={this.handleOpenOrgSwitcher}
								>
									<svg class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24">
										<path
											stroke-linecap="round"
											stroke-linejoin="round"
											d="M7.5 21 3 16.5m0 0L7.5 12M3 16.5h13.5m0-13.5L21 7.5m0 0L16.5 12M21 7.5H7.5"
										/>
									</svg>
									<div>
										<span>{this.switchOrgText}</span>
										{this.user?.orgId && (
											<span class="text-xs text-muted block">{this.user.orgSlug || this.user.orgId}</span>
										)}
										{!this.user?.orgId && <span class="text-xs text-muted block">{this.personalAccessText}</span>}
									</div>
								</button>
							) : (
								<div class="p-3 space-y-2 max-h-48 overflow-y-auto">
									{this.loadingOrgs ? (
										<div class="flex justify-center py-2">
											<div class="w-5 h-5 border-2 border-accent border-t-transparent rounded-full animate-spin" />
										</div>
									) : (
										[
											<button
												type="button"
												key="personal-access-btn"
												class={`w-full flex items-center gap-2 px-3 py-2 rounded text-left text-sm hover:bg-accent/10 transition-colors cursor-pointer ${!this.user?.orgId ? "bg-accent/15 font-semibold" : ""}`}
												onClick={() => this.handleSwitchOrg()}
											>
												<svg
													class="w-4 h-4 shrink-0"
													fill="none"
													stroke="currentColor"
													stroke-width="2"
													viewBox="0 0 24 24"
												>
													<path
														stroke-linecap="round"
														stroke-linejoin="round"
														d="M15.75 6a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0ZM4.501 20.118a7.5 7.5 0 0 1 14.998 0A17.933 17.933 0 0 1 12 21.75c-2.676 0-5.216-.584-7.499-1.632Z"
													/>
												</svg>
												{this.personalAccessText}
											</button>,
											...this.userOrgs.map((org) => (
												<button
													type="button"
													key={`org-${org.orgId}`}
													class={`w-full flex items-center gap-2 px-3 py-2 rounded text-left text-sm hover:bg-accent/10 transition-colors cursor-pointer ${this.user?.orgId === org.orgId ? "bg-accent/15 font-semibold" : ""}`}
													onClick={() => this.handleSwitchOrg(org.orgId)}
												>
													<svg
														class="w-4 h-4 shrink-0"
														fill="none"
														stroke="currentColor"
														stroke-width="2"
														viewBox="0 0 24 24"
													>
														<path
															stroke-linecap="round"
															stroke-linejoin="round"
															d="M2.25 21h19.5m-18-18v18m10.5-18v18m6-13.5V21M6.75 6.75h.75m-.75 3h.75m-.75 3h.75m3-6h.75m-.75 3h.75m-.75 3h.75M6.75 21v-3.375c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21M3 3h12m-.75 4.5H21m-3.75 0h.008v.008h-.008V7.5Z"
														/>
													</svg>
													{org.slug}
												</button>
											)),
										]
									)}
								</div>
							)}
						</div>
						{/* Mi cuenta */}
						<div class="border-t border-divider">
							<a
								href={this.accountUrl || this.getDefaultAccountUrl()}
								class="flex w-full items-center gap-2 px-4 py-3 text-left hover:bg-accent/10 text-text hover:cursor-pointer transition-colors"
								role="menuitem"
							>
								<svg class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24">
									<path
										stroke-linecap="round"
										stroke-linejoin="round"
										d="M15.75 6a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0ZM4.501 20.118a7.5 7.5 0 0 1 14.998 0A17.933 17.933 0 0 1 12 21.75c-2.676 0-5.216-.584-7.499-1.632Z"
									/>
								</svg>
								{this.accountText}
							</a>
						</div>
						{/* Separador y logout */}
						<div class="border-t border-divider">
							<button
								type="button"
								class="flex w-full items-center gap-2 px-4 py-3 text-left bg-neutral-900 hover:bg-primary hover:text-tprimary hover:cursor-pointer text-red-600 transition-colors"
								role="menuitem"
								onClick={this.handleLogout}
							>
								<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
									<path
										stroke-linecap="round"
										stroke-linejoin="round"
										stroke-width="2"
										d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1"
									/>
								</svg>
								{this.logoutText}
							</button>
						</div>
					</div>
				)}
			</div>
		);
	}
}
