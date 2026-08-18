import { Component, Prop, Element, Host, Event, EventEmitter, Watch } from "@stencil/core";
import type { AccessMenuItem } from "../../molecules/adc-access-button/adc-access-button.js";
import { isPrivateHost } from "@common/utils/url-utils.js";
const port = () => (globalThis.location?.port ? `:${globalThis.location?.port}` : "");

/** Movimiento sostenido en un sentido antes de invertir el estado: sin umbral, el trackpad parpadea. */
const FLIP_THRESHOLD_PX = 6;
/** Franja del tope donde la barra siempre se ve, así el primer flick nunca la esconde. */
const ALWAYS_VISIBLE_PX = 96;
/** Rebote elástico de iOS: en los últimos px del documento el delta llega invertido. */
const RUBBER_BAND_PX = 2;
/** Corte del re-muestreo por frame si `transitionend` no llega (pestaña en background). */
const SLIDE_SAMPLE_MS = 400;

@Component({
	tag: "adc-site-header",
	styleUrl: "adc-site-header.css",
	shadow: false,
})
export class AdcSiteHeader {
	@Element() el!: HTMLElement;

	@Prop() logoSrc: string = "";
	@Prop() logoAlt: string = "";
	@Prop() homeHref: string = "/";

	@Prop() authUrl: string = `${globalThis.location?.protocol}//auth.adigitalcafe.com${port()}`;

	@Prop() apiBaseUrl: string = isPrivateHost(globalThis.location?.hostname ?? "")
		? `${globalThis.location?.protocol}//${globalThis.location?.hostname}:3000`
		: "";

	@Prop() showAccessButton: boolean = true;
	@Prop() userMenuItems: AccessMenuItem[] = [];

	/**
	 * Apps con menú lateral propio (drive, correo): en mobile el logo pasa a ser el
	 * botón que abre ese menú. El objetivo táctil del header es mucho más cómodo que
	 * una flecha flotante sobre el contenido.
	 */
	@Prop() mobileMenu: boolean = false;
	/** Estado del menú de la app, para el `aria-expanded` y el icono. */
	@Prop() mobileMenuOpen: boolean = false;
	@Prop() mobileMenuLabel: string = "Menú";

	/** Emite el estado pedido (`true` = abrir). */
	@Event() adcMobileMenuToggle!: EventEmitter<boolean>;

	private lastY = 0;
	private accum = 0;
	private isHidden = false;
	private scrollQueued = false;
	private slideRaf = 0;
	private slideUntil = 0;
	private naturalHeight = 0;
	private bannerEl: HTMLElement | null = null;
	private resizeObserver?: ResizeObserver;

	componentDidLoad() {
		this.lastY = Math.max(window.scrollY, 0);
		this.updateVars();

		window.addEventListener("scroll", this.onScroll, { passive: true });
		window.addEventListener("resize", this.onViewportChange);
		window.visualViewport?.addEventListener("resize", this.onViewportChange);
		// Un salto a un ancla no puede terminar debajo de la barra que vuelve a entrar.
		window.addEventListener("hashchange", this.forceVisible);
		// Volver con Shift+Tab a un control del header tiene que revelarlo.
		this.el.addEventListener("focusin", this.forceVisible);
		this.el.addEventListener("transitionend", this.onTransitionEnd);

		// El alto cambia solo (campana, botón de acceso, banner llegan por fetch): sin esto
		// el `top` del sidebar queda viejo hasta el siguiente scroll.
		this.resizeObserver = new ResizeObserver(this.updateVars);
		this.resizeObserver.observe(this.el);
	}

	disconnectedCallback() {
		window.removeEventListener("scroll", this.onScroll);
		window.removeEventListener("resize", this.onViewportChange);
		window.visualViewport?.removeEventListener("resize", this.onViewportChange);
		window.removeEventListener("hashchange", this.forceVisible);
		this.el.removeEventListener("focusin", this.forceVisible);
		this.el.removeEventListener("transitionend", this.onTransitionEnd);
		this.resizeObserver?.disconnect();
		if (this.slideRaf) cancelAnimationFrame(this.slideRaf);
	}

	/** Con el drawer abierto la barra no puede irse: el botón que lo cierra vive en ella. */
	@Watch("mobileMenuOpen")
	onMobileMenuOpenChange(open: boolean) {
		if (open) this.forceVisible();
	}

	private readonly onScroll = () => {
		if (this.scrollQueued) return;
		this.scrollQueued = true;
		requestAnimationFrame(this.evaluateScroll);
	};

	private readonly evaluateScroll = () => {
		this.scrollQueued = false;

		const y = Math.max(window.scrollY, 0);
		const delta = y - this.lastY;
		this.lastY = y;
		this.updateVars();

		if (this.isPinned()) {
			this.forceVisible();
			return;
		}

		// Los últimos px del documento son el rebote elástico: ahí el delta miente.
		const maxY = document.documentElement.scrollHeight - window.innerHeight;
		if (y >= maxY - RUBBER_BAND_PX) return;

		if (y <= Math.max(ALWAYS_VISIBLE_PX, this.naturalHeight * 2)) {
			this.forceVisible();
			return;
		}

		if (delta === 0) return;
		// Al cambiar de sentido el acumulador arranca de cero: sólo cuenta el gesto sostenido.
		if (Math.sign(delta) !== Math.sign(this.accum)) this.accum = 0;
		this.accum += delta;

		if (this.accum >= FLIP_THRESHOLD_PX) this.setHidden(true);
		else if (this.accum <= -FLIP_THRESHOLD_PX) this.setHidden(false);
	};

	/** Situaciones en las que esconder la barra dejaría controles fuera de alcance. */
	private isPinned(): boolean {
		return this.mobileMenuOpen || this.el.contains(document.activeElement) || !!document.querySelector("adc-modal[open]");
	}

	private readonly forceVisible = () => {
		this.setHidden(false);
	};

	private readonly onViewportChange = () => {
		this.forceVisible();
		this.updateVars();
	};

	/**
	 * El estado viaja como atributo del host, nunca por `@State`: re-renderizar un componente
	 * `shadow: false` cuyo `<slot>` lleva hijos React revienta con "insertBefore … is not a
	 * child of this node".
	 */
	private setHidden(hidden: boolean) {
		this.accum = 0;
		if (hidden === this.isHidden) return;
		this.isHidden = hidden;
		this.el.toggleAttribute("data-hidden", hidden);
		this.sampleWhileSliding();
	}

	/**
	 * Re-muestrea las variables en cada frame del deslizamiento: el sidebar anima
	 * `transform`/`width` pero NO `top`, así que un `--header-offset` congelado lo deja
	 * con el borde superior a mitad de camino.
	 */
	private sampleWhileSliding() {
		this.slideUntil = performance.now() + SLIDE_SAMPLE_MS;
		if (this.slideRaf) return;

		const step = () => {
			this.updateVars();
			this.slideRaf = performance.now() >= this.slideUntil ? 0 : requestAnimationFrame(step);
		};
		this.slideRaf = requestAnimationFrame(step);
	}

	private readonly onTransitionEnd = (ev: TransitionEvent) => {
		// Sólo el deslizamiento propio: la transición de cualquier hijo cortaría el muestreo antes.
		if (ev.target !== this.el || ev.propertyName !== "transform") return;
		this.slideUntil = 0;
		this.updateVars();
	};

	/** Se pinta vacío hasta que resuelve su fetch; se busca tarde y se revalida por si lo remontan. */
	private bannerRect(): DOMRect | null {
		if (!this.bannerEl?.isConnected) this.bannerEl = document.querySelector<HTMLElement>("adc-banner-host");
		return this.bannerEl?.getBoundingClientRect() ?? null;
	}

	private readonly updateVars = () => {
		const rect = this.el.getBoundingClientRect();

		// `bottom` sirve en los tres estados: quieto y pegado vale el alto, y escondido vale 0
		// (el rect ya viene transformado), con lo que el sidebar se estira a pantalla completa.
		// El banner vive fuera del header desde que el host es sticky, así que hay que sumarlo.
		const offset = Math.max(rect.bottom, this.bannerRect()?.bottom ?? 0, 0);

		this.naturalHeight = rect.height;
		document.documentElement.style.setProperty("--header-h", `${rect.height}px`);
		document.documentElement.style.setProperty("--header-offset", `${offset}px`);
	};

	private readonly handleMobileMenuClick = () => {
		this.adcMobileMenuToggle.emit(!this.mobileMenuOpen);
	};

	private renderLogo() {
		if (!this.logoSrc) return null;
		return <img src={this.logoSrc} alt={this.logoAlt} height="39" width="39" style={{ minWidth: "39px" }} class="rounded-full" />;
	}

	/** Cara funcional del botón: hamburguesa, o cruz mientras el menú está abierto. */
	private renderMenuIcon() {
		const path = this.mobileMenuOpen ? "M6 6l12 12M18 6L6 18" : "M4 7h16M4 12h16M4 17h16";
		return (
			<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">
				<path d={path} />
			</svg>
		);
	}

	private renderBrand() {
		const logoLink = (
			<a key="brand-logo" href={this.homeHref} aria-label="Inicio" class={this.mobileMenu ? "ml-2 adc-header-brand" : "ml-2"}>
				{this.renderLogo()}
			</a>
		);

		if (!this.mobileMenu) return logoLink;

		return [
			<button
				key="brand-menu"
				type="button"
				class="adc-header-menu ml-2"
				aria-label={this.mobileMenuLabel}
				aria-expanded={this.mobileMenuOpen ? "true" : "false"}
				onClick={this.handleMobileMenuClick}
			>
				<span class="adc-header-menu__flip" data-open={this.mobileMenuOpen ? "true" : "false"}>
					<span class="adc-header-menu__face">{this.renderMenuIcon()}</span>
					<span class="adc-header-menu__face adc-header-menu__face--logo" aria-hidden="true">
						{this.renderLogo()}
					</span>
				</span>
			</button>,
			logoLink,
		];
	}

	render() {
		return (
			<Host>
				<header class="flex items-center justify-between gap-3 px-4 py-4 md:gap-6 md:px-8 md:py-6 shadow-cozy bg-header text-theader font-bold rounded-b-xxl">
					{this.renderBrand()}

					<nav class="flex flex-wrap items-center justify-end gap-2 md:gap-4" style={{ minHeight: "48px" }} aria-label="Menu">
						<slot></slot>

						<adc-apps-menu></adc-apps-menu>

						{/* Engranaje de la app que esté montada (Drive, Correo, …). Se pinta sólo si esa app
						    lo enciende; el modal con las pestañas lo pone ella. */}
						<adc-settings-menu></adc-settings-menu>

						{/* Campana de notificaciones: se auto-oculta si el backend (preset adc-notifications) no responde. */}
						<adc-notification-bell></adc-notification-bell>

						{this.showAccessButton && (
							<adc-access-button
								auth-url={this.authUrl}
								api-base-url={this.apiBaseUrl}
								menuItems={this.userMenuItems}
							></adc-access-button>
						)}
					</nav>
				</header>
			</Host>
		);
	}
}
