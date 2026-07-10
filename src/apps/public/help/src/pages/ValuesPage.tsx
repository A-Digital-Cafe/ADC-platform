import "@ui-library/utils/react-jsx";
import PageShell from "../components/PageShell";
import { BLOCKED_COUNTRIES } from "../data/blocked-countries";

type StepStatus = "publicado" | "en-redaccion" | "planificado";

const STEP_STATUS_LABEL: Record<StepStatus, string> = {
	publicado: "Publicado",
	"en-redaccion": "En redacción",
	planificado: "Planificado",
};

const STEP_STATUS_COLOR = {
	publicado: "green",
	"en-redaccion": "yellow",
	planificado: "blue",
} as const satisfies Record<StepStatus, "gray" | "red" | "orange" | "yellow" | "green" | "teal" | "blue" | "indigo" | "purple" | "pink">;

const GNI_STEPS: Array<{ step: string; title: string; href: string; status: StepStatus; purpose: string; where: string; pending: string }> = [
	{
		step: "Paso A",
		title: "HRIA — Evaluación de Impacto en Derechos Humanos",
		href: "/hria",
		status: "publicado",
		purpose: "Identificar impactos sobre privacidad, libertad de expresión, seguridad personal, discriminación y grupos vulnerables.",
		where: "La página HRIA contiene el checklist público por bloque y estado.",
		pending: "Completar evidencia, responsables, fuentes, decisiones y revisión periódica.",
	},
	{
		step: "Paso B",
		title: "Política de respuesta a autoridades",
		href: "/authority-requests",
		status: "en-redaccion",
		purpose: "Definir cómo evaluar solicitudes legales, gubernamentales o regulatorias sin perder proporcionalidad ni trazabilidad.",
		where: "La página de respuesta a autoridades detalla canal provisional, criterios, registro auditable y escalado pendiente.",
		pending: "Cerrar procedimiento operativo, modelo de registro, criterios de notificación y decisiones de rechazo/escalado.",
	},
	{
		step: "Paso C",
		title: "Reporte de transparencia",
		href: "/transparency",
		status: "en-redaccion",
		purpose: "Definir qué métricas publicar sobre solicitudes, moderación, derechos de privacidad, geofiltro, seguridad e incidentes.",
		where: "La página de transparencia lista métricas previstas y dependencias antes del primer reporte periódico.",
		pending: "Definir cadencia, granularidad segura, fuente de datos y formato de publicación.",
	},
];

export function ValuesPage() {
	return (
		<PageShell
			title="Valores y Espacio Seguro"
			subtitle='ADC busca ser un "Espacio seguro para todos 🏳️‍🌈".'
			standards={["GNI (HRIA)", "Derechos humanos"]}
			declaration="commitment"
			breadcrumb={[{ label: "Inicio", href: "/" }, { label: "Valores" }]}
		>
			<h2 id="nuestros-valores">Nuestros valores</h2>
			<ul>
				<li>
					<strong>Inclusión:</strong> respetamos identidades, orientaciones y orígenes diversos.
				</li>
				<li>
					<strong>Aprendizaje compartido:</strong> el conocimiento se construye en comunidad.
				</li>
				<li>
					<strong>Transparencia:</strong> documentamos políticas, cambios y decisiones.
				</li>
				<li>
					<strong>Responsabilidad:</strong> rendimos cuentas de nuestros compromisos públicos.
				</li>
			</ul>

			<h2 id="marco-gni">Marco GNI (Global Network Initiative)</h2>
			<p>
				Adoptamos como referencia los principios GNI sobre libertad de expresión y privacidad. Para que no quede como una lista
				abstracta, cada paso tiene una página propia con qué se está documentando y qué falta cerrar.
			</p>
			<div className="space-y-4">
				{GNI_STEPS.map((item) => (
					<section key={item.step} className="border-l-2 pl-3">
						<div className="flex flex-wrap items-center gap-2">
							<adc-badge color="indigo">{item.step}</adc-badge>
							<adc-badge color={STEP_STATUS_COLOR[item.status]}>{STEP_STATUS_LABEL[item.status]}</adc-badge>
						</div>
						<h3 className="mt-2 text-xl font-heading">
							<a href={item.href}>{item.title}</a>
						</h3>
						<p>{item.purpose}</p>
						<p className="text-sm opacity-80">
							<strong>Dónde se trabaja:</strong> <a href={item.href}>{item.where}</a>
						</p>
						<p className="text-sm opacity-80">
							<strong>Qué falta:</strong> {item.pending}
						</p>
					</section>
				))}
			</div>

			<adc-callout tone="info" role="note">
				Estos pasos describen trabajo público y trazable, no certificación externa ni cumplimiento ya auditado. Las páginas enlazadas se
				actualizan a medida que haya decisiones confirmadas.
			</adc-callout>

			<h2 id="espacio-seguro">Espacio seguro para todos 🏳️‍🌈</h2>
			<p>
				No toleramos discurso de odio, acoso ni discriminación por orientación sexual, identidad o expresión de género, etnia, religión,
				discapacidad, edad u otras características protegidas.
			</p>
			<p>
				Reconocemos que existen jurisdicciones donde las{" "}
				<a href="https://database.ilga.org/criminalisation-consensual-same-sex-sexual-acts" rel="noreferrer">
					interacciones entre personas LGBTQ+ están criminalizadas
				</a>
				{" "}o en las que el contexto legal/de seguridad implica un riesgo elevado para nuestra comunidad.
			</p>

			<h2 id="geofiltro-activo">Geofiltro activo</h2>
			<p>
				Como medida operativa, aplicamos un filtro a nivel <strong>Cloudflare</strong> que{" "}
				<strong>bloquea el acceso desde los países listados abajo</strong> y aplica un <em>Managed Challenge</em> a bots o dispositivos
				desconocidos. Esto es una decisión de prudencia hacia la comunidad, no un juicio sobre las personas que viven en esos lugares.
			</p>
			<details>
				<summary>Lista actual ({BLOCKED_COUNTRIES.length} países, ISO 3166-1 alpha-2)</summary>
				<ul className="grid gap-x-6 gap-y-1 sm:grid-cols-2 md:grid-cols-3 text-sm mt-2">
					{BLOCKED_COUNTRIES.map((c) => (
						<li key={c.code}>
							<code>{c.code}</code> — {c.name}
						</li>
					))}
				</ul>
			</details>
			<adc-callout tone="info" role="note">
				La lista puede revisarse cuando cambien las condiciones legales o de seguridad. Si crees que tu país está bloqueado por error o
				quieres reportar contexto adicional, contacta por los canales de <a href="/contact#canales">contacto</a>.
			</adc-callout>

			<h2 id="reportes">Reportes</h2>
			<p>
				Cualquier conducta contraria a estos valores puede reportarse por los canales de <a href="/contact#canales">contacto</a>.
			</p>
		</PageShell>
	);
}
