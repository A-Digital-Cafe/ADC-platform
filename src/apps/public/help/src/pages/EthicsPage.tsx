import "@ui-library/utils/react-jsx";
import PageShell from "../components/PageShell";

export function EthicsPage() {
	return (
		<PageShell
			title="Código de Ética"
			subtitle="Compromisos operativos y autodeclaración de conformidad."
			standards={["ISO/IEC 17050-1 (autodeclaración)"]}
			declaration="commitment"
			breadcrumb={[{ label: "Inicio", href: "/" }, { label: "Ética" }]}
		>
			<h2>Compromisos</h2>
			<ul>
				<li>Respeto a las personas usuarias y a la comunidad.</li>
				<li>Protección de datos personales y minimización en la recolección.</li>
				<li>Transparencia sobre decisiones que afecten a la comunidad.</li>
				<li>Trazabilidad: cada política tiene una fecha de revisión visible.</li>
				<li>No sobreprometer: no afirmamos cumplimiento, certificaciones o auditorías que no estén verificadas.</li>
			</ul>

			<h2>No sobreprometer</h2>
			<p>
				Las páginas de ayuda, privacidad, seguridad y roadmap deben distinguir entre hechos confirmados, compromisos públicos y trabajo
				pendiente. ADC no debe presentar como cumplido algo que todavía no fue implementado, revisado o confirmado.
			</p>

			<h2>Privacidad por diseño</h2>
			<p>
				Cada función nueva debe considerar minimización de datos, finalidad clara, retención razonable, controles de acceso y revisión de
				subprocesadores antes de ampliar el tratamiento de datos personales.
			</p>

			<h2>Seguridad responsable</h2>
			<p>
				Los reportes de vulnerabilidades hechos de buena fe deben tratarse con prioridad, respeto y coordinación. El canal actual para
				reportarlos está en <a href="/contact">contacto</a>, mientras se define un sistema público de tickets.
			</p>

			<h2>Debido proceso comunitario</h2>
			<p>
				Las decisiones de moderación o suspensión deben buscar proporcionalidad, contexto y posibilidad de revisión cuando sea viable.
				Las reglas aplicables a personas usuarias se describen en los <a href="/terms">términos</a>.
			</p>

			<h2>Derechos humanos / GNI</h2>
			<p>
				Tomamos como referencia los principios GNI sobre privacidad y libertad de expresión. Para evaluar riesgos de seguridad por país
				revisamos la base de ILGA sobre{" "}
				<a href="https://database.ilga.org/criminalisation-consensual-same-sex-sexual-acts" rel="noreferrer">
					criminalización de relaciones consensuales entre personas del mismo sexo
				</a>
				. Las solicitudes, reportes o correcciones de contexto pueden enviarse desde <a href="/contact">contacto</a>.
			</p>

			<h2>Accesibilidad e inclusión</h2>
			<p>
				ADC debe diseñarse para personas con distintas capacidades, idiomas, identidades y contextos. La accesibilidad WCAG 2.1 AA se
				mantiene como referencia de trabajo y sus avances se reflejan en el <a href="/roadmap">roadmap</a>.
			</p>

			<h2>Conflictos de interés</h2>
			<p>
				Las decisiones técnicas, editoriales o comunitarias no deben ocultar intereses comerciales, publicidad, patrocinios o relaciones
				externas relevantes. El subdominio <code>games</code> incorporará publicidad; esa decisión debe documentarse de forma separada y
				clara, incluyendo proveedores, criterios de consentimiento y cualquier impacto sobre privacidad cuando estén definidos.
			</p>

			<h2>Trazabilidad</h2>
			<p>
				Cada política importante debe tener fecha de revisión, estado público y relación con una página, un pendiente interno o el
				roadmap. Cuando una decisión cambie, el cambio debe poder explicarse con contexto suficiente.
			</p>

			<h2>Autodeclaración (ISO/IEC 17050-1)</h2>
			<p>
				Bajo el espíritu de la norma ISO/IEC 17050-1 (autodeclaraciones de conformidad), declaramos como{" "}
				<strong>compromiso público y no como certificación externa</strong> que trabajamos para alinear la plataforma con:
			</p>
			<ul>
				<li>GDPR — protección de datos personales.</li>
				<li>OWASP ASVS — seguridad de aplicación.</li>
				<li>ISO 25010:2023 — calidad de software.</li>
				<li>WCAG 2.1 AA — accesibilidad.</li>
				<li>ISO 27001, ISO 9001, SOC 2 — referencias de gobernanza, calidad y controles.</li>
			</ul>

			<adc-callout tone="warning" role="note">
				Esta declaración es responsable y revisable: indica intención y trazabilidad. No sustituye una auditoría independiente. Los
				avances concretos se reflejan en el <a href="/roadmap">roadmap</a>.
			</adc-callout>

			<h2>Sanciones internas</h2>
			<p>
				El incumplimiento de este código por parte del equipo puede acarrear medidas internas proporcionales. El incumplimiento por parte
				de personas usuarias se rige por los <a href="/terms">términos</a>.
			</p>
		</PageShell>
	);
}
