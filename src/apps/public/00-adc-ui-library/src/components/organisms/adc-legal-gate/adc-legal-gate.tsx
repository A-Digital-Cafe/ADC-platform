/**
 * Gate de re-aceptación de los documentos legales.
 *
 * Cuando una versión nueva de los Términos o de la Política de Privacidad entra en vigor
 * (`effectiveFrom`), las cuentas que aceptaron una versión anterior tienen que aceptar la nueva.
 * El corte se hace acá, en el header que ya monta cada app, y no con un middleware que responda
 * 403: un bloqueo así sería opaco y, dejaría a la persona sin poder ejercer sus
 * derechos. Por eso:
 *
 * - las apps de `EXEMPT_APPS` nunca muestran el gate — `help` publica el texto que se pide
 *   aceptar y los canales para pedir los datos o la baja, `my-account` es donde se gestiona la
 *   cuenta y `adc-status` es donde se abre el ticket de tipo «Datos» al que remiten los Términos;
 *   si el gate las tapara, aceptar sería la única salida y eso no es consentimiento;
 * - la casilla nace desmarcada y el panel enumera qué documento cambió, con enlace al texto;
 * - siempre hay salida por "cerrar sesión".
 */
import { Component, Prop, State, Host } from "@stencil/core";
import { getSession } from "../../../../utils/session.js";
import { createAdcApi } from "../../../../utils/adc-fetch.js";
import { forceLogoutAndRefresh } from "../../../../utils/auth-sync.js";
import { resolvePlatformPath } from "../../../../utils/platform-links.js";
import { currentLegalVersions } from "@common/utils/legal-docs.js";

interface PendingDoc {
	id: string;
	label: string;
	version: string;
	effectiveFrom: string;
	href: string;
}

interface LegalStatus {
	pending: PendingDoc[];
	acceptedAt?: string;
	acceptedVersions?: { termsVersion: string; privacyVersion: string };
}

/** Apps que el gate nunca tapa (ver docstring: ejercicio de derechos sin aceptar). */
const EXEMPT_APPS = new Set(["help", "my-account", "adc-auth", "adc-status"]);

const api = createAdcApi({ basePath: "/api/auth", devPort: 3000 });

function helpLink(path: string): string {
	return resolvePlatformPath("help", path) ?? path;
}

@Component({
	tag: "adc-legal-gate",
	shadow: false,
})
export class AdcLegalGate {
	/** App actual (nombre base); si vacío usa `window.__ADC_APP__`. */
	@Prop() app: string = "";

	@State() pending: PendingDoc[] = [];
	/** La constancia previa ya declaró la edad; sin constancia hay que volver a pedirla. */
	@State() needsAge = false;
	@State() accepted = false;
	@State() ageConfirmed = false;
	@State() submitting = false;
	@State() error = "";

	/** Sin `await`: el header no puede quedar esperando dos round-trips para pintarse. */
	componentWillLoad() {
		void this.#check();
	}

	async #check(): Promise<void> {
		const current = this.app || (globalThis as { __ADC_APP__?: string }).__ADC_APP__ || "";
		if (EXEMPT_APPS.has(current)) return;

		const session = await getSession(false);
		if (!session.authenticated) return;

		const result = await api.get<LegalStatus>("/legal/status", { silent: true });
		if (!result.success || !result.data?.pending?.length) return;

		this.pending = result.data.pending;
		this.needsAge = !result.data.acceptedVersions;
	}

	private readonly submit = async () => {
		if (!this.accepted || (this.needsAge && !this.ageConfirmed) || this.submitting) return;
		this.submitting = true;
		this.error = "";

		const result = await api.post<{ success: boolean }>("/legal/accept", {
			body: { accepted: true, ageConfirmed: this.ageConfirmed || undefined, ...currentLegalVersions() },
			silent: true,
		});

		this.submitting = false;
		if (result.success) {
			this.pending = [];
			return;
		}
		this.error =
			result.errorKey === "LEGAL_VERSION_MISMATCH"
				? "Los documentos se actualizaron mientras tenías esta pantalla abierta. Recargá para leer la versión vigente."
				: result.message || "No pudimos registrar tu aceptación. Probá de nuevo en unos minutos.";
	};

	render() {
		if (this.pending.length === 0) return null;
		const canSubmit = this.accepted && (!this.needsAge || this.ageConfirmed) && !this.submitting;

		return (
			<Host>
				<adc-modal
					open
					hideChrome
					dismissOnBackdrop={false}
					dismissOnEscape={false}
					size="lg"
					modalTitle="Actualizamos nuestros documentos legales"
				>
					<div class="flex flex-col gap-4 px-6 py-6 text-text">
						<h2 class="font-heading text-lg font-semibold">Actualizamos nuestros documentos legales</h2>
						<p class="text-sm text-muted">
							Cambió el texto que aceptaste al crear tu cuenta. Te lo anunciamos con antelación y la versión nueva ya está en
							vigor: para seguir usando la plataforma necesitamos que la aceptes.
						</p>

						<ul class="flex flex-col gap-2">
							{this.pending.map((doc) => (
								<li key={doc.id} class="text-sm">
									<a class="text-accent underline" href={helpLink(doc.href)} target="_blank" rel="noopener noreferrer">
										{doc.label} — versión {doc.version}
									</a>
									<span class="text-muted"> · en vigor desde el {doc.effectiveFrom}</span>
								</li>
							))}
						</ul>

						<label class="flex items-start gap-2 text-sm cursor-pointer">
							<input
								type="checkbox"
								class="mt-1"
								checked={this.accepted}
								onChange={(e) => (this.accepted = (e.target as HTMLInputElement).checked)}
							/>
							<span>Leí y acepto la versión vigente de los documentos que figuran arriba.</span>
						</label>

						{this.needsAge && (
							<label class="flex items-start gap-2 text-sm cursor-pointer">
								<input
									type="checkbox"
									class="mt-1"
									checked={this.ageConfirmed}
									onChange={(e) => (this.ageConfirmed = (e.target as HTMLInputElement).checked)}
								/>
								<span>Confirmo que cumplo con la edad mínima para usar la plataforma.</span>
							</label>
						)}

						{this.error && (
							<p class="text-sm text-danger" role="alert">
								{this.error}
							</p>
						)}

						<div class="flex flex-wrap justify-end gap-2">
							<button
								type="button"
								class="rounded-xxl border border-surface px-4 py-2 text-sm text-muted hover:text-text min-h-11 touch-manipulation"
								onClick={() => void forceLogoutAndRefresh()}
							>
								Cerrar sesión
							</button>
							<button
								type="button"
								class="rounded-xxl bg-primary text-tprimary px-4 py-2 text-sm font-semibold min-h-11 touch-manipulation disabled:opacity-50"
								disabled={!canSubmit}
								onClick={this.submit}
							>
								{this.submitting ? "Guardando…" : "Aceptar y continuar"}
							</button>
						</div>

						<p class="text-xs text-muted border-t border-surface pt-3">
							No hace falta que aceptes para leer los documentos, pedir una copia de tus datos, rectificarlos o dar de baja la
							cuenta: esos trámites siguen abiertos en tu cuenta y en&nbsp;
							<a class="text-accent underline" href={helpLink("/contact")} target="_blank" rel="noopener noreferrer">
								los canales de contacto
							</a>
							.
						</p>
					</div>
				</adc-modal>
			</Host>
		);
	}
}
