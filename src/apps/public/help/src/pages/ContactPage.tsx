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
			<h2>Canales</h2>
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

			<h2>¿Para qué usar cada canal?</h2>
			<ul>
				<li>
					<strong>Privacidad y datos personales:</strong> ejercicio de derechos GDPR (acceso, rectificación, supresión, portabilidad,
					oposición).
				</li>
				<li>
					<strong>Reporte de incidentes éticos o de comunidad:</strong> conductas contrarias a nuestros <a href="/values">valores</a>.
				</li>
				<li>
					<strong>Bug bounty informativo:</strong> reportes de seguridad o errores. En esta fase los reportes se gestionan manualmente;
					el sistema público con tickets, hashes y status está en el <a href="/roadmap">roadmap</a>.
				</li>
				<li>
					<strong>Consultas generales:</strong> dudas sobre el sitio o la comunidad.
				</li>
			</ul>

			<h2>Tiempos de respuesta</h2>
			<p>
				Atendemos en plazos razonables. Si tu reporte involucra riesgo de seguridad activo, indícalo claramente en el asunto para
				priorizarlo.
			</p>
		</PageShell>
	);
}
