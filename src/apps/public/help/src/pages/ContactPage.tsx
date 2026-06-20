import "@ui-library/utils/react-jsx";
import PageShell from "../components/PageShell";
import { CONTACTS } from "../data/contact";

export function ContactPage() {
	return (
		<PageShell
			title="Contacto"
			subtitle="Canales para privacidad, soporte, ética y bug bounty informativo."
			declaration="informational"
			breadcrumb={[{ label: "Inicio", href: "/" }, { label: "Contacto" }]}
		>
			<h2 id="canales">Canales</h2>
			<ul>
				<li>
					<strong>Email:</strong> <a href={`mailto:${CONTACTS.email}`}>{CONTACTS.email}</a>
				</li>
				<li>
					<strong>Discord:</strong>{" "}
					<a href={CONTACTS.discordUrl} rel="noreferrer">
						{CONTACTS.discordHandle}
					</a>
				</li>
			</ul>

			<h2 id="para-que-usar-cada-canal">¿Para qué usar cada canal?</h2>
			<ul>
				<li>
					<strong>Privacidad y datos personales:</strong> ejercicio de <a href="/privacy#tus-derechos">derechos GDPR</a> (acceso,
					rectificación, supresión, portabilidad, oposición).
				</li>
				<li>
					<strong>Reporte de incidentes éticos o de comunidad:</strong> conductas contrarias a nuestros{" "}
					<adc-platform-link href="/values#reportes">valores</adc-platform-link>.
				</li>
				<li>
					<strong>Solicitudes de autoridades:</strong> canal provisional mientras se cierra la{" "}
					<adc-platform-link href="/authority-requests">política de respuesta</adc-platform-link>.
				</li>
				<li>
					<strong>Bug bounty:</strong> reportá vulnerabilidades abriendo un ticket de tipo Seguridad en el{" "}
					<adc-platform-link href="https://status.adigitalcafe.com/status/tickets" rel="noreferrer">
						subdominio de estado
					</adc-platform-link>
					. Cada reporte entra en el{" "}
					<adc-platform-link href="https://status.adigitalcafe.com/status/bounty" rel="noreferrer">
						log público de transparencia
					</adc-platform-link>{" "}
					(id, fecha/hora, hash y estado) y, si aceptás crédito, en{" "}
					<adc-platform-link href="https://status.adigitalcafe.com/status/bounty">agradecimientos</adc-platform-link>. Recompensamos con beneficios temporales según{" "}
					severidad (ver{" "}
					<adc-external-link href="https://github.com/A-Digital-Cafe/ADC-platform/blob/main/.github/SECURITY.md">
						política de seguridad
					</adc-external-link>
					).
				</li>
				<li>
					<strong>Consultas generales:</strong> dudas sobre el sitio o la comunidad.
				</li>
			</ul>

			<h2 id="tiempos-de-respuesta">Tiempos de respuesta</h2>
			<p>
				Atendemos en plazos razonables. Si tu reporte involucra riesgo de seguridad activo, indícalo claramente en el asunto para
				priorizarlo.
			</p>
		</PageShell>
	);
}
