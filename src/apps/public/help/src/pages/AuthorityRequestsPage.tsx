import "@ui-library/utils/react-jsx";
import PageShell from "../components/PageShell";

type Status = "en-redaccion" | "planificado" | "no-iniciado";

interface WorkItem {
	title: string;
	status: Status;
	where: string;
	next: string;
}

const STATUS_LABEL: Record<Status, string> = {
	"en-redaccion": "En redacción",
	planificado: "Planificado",
	"no-iniciado": "No iniciado",
};

const STATUS_COLOR = {
	"en-redaccion": "yellow",
	planificado: "blue",
	"no-iniciado": "gray",
} as const satisfies Record<Status, "gray" | "red" | "orange" | "yellow" | "green" | "teal" | "blue" | "indigo" | "purple" | "pink">;

const WORK_ITEMS: WorkItem[] = [
	{
		title: "Alcance de solicitudes cubiertas",
		status: "en-redaccion",
		where: "Esta página define el alcance público inicial.",
		next: "Separar solicitudes de datos, preservación, retiro de contenido, bloqueo, seguridad y contacto informal.",
	},
	{
		title: "Canal de recepción",
		status: "en-redaccion",
		where: "Hoy se centraliza en /contact como canal provisional.",
		next: "Crear un flujo dedicado con identificador, fecha, solicitante, país/jurisdicción y tipo de solicitud.",
	},
	{
		title: "Verificación de legitimidad",
		status: "planificado",
		where: "Pendiente de procedimiento interno.",
		next: "Exigir solicitud escrita, base legal, autoridad competente, alcance exacto y datos mínimos necesarios.",
	},
	{
		title: "Necesidad y proporcionalidad",
		status: "planificado",
		where: "Pendiente de checklist operativo.",
		next: "Revisar si la solicitud es específica, limitada, necesaria y compatible con derechos humanos.",
	},
	{
		title: "Minimización de respuesta",
		status: "planificado",
		where: "Relacionado con /privacy y retención de logs.",
		next: "Definir cómo entregar sólo lo requerido, con redacciones cuando corresponda y sin ampliar datos por conveniencia.",
	},
	{
		title: "Notificación a personas afectadas",
		status: "no-iniciado",
		where: "Pendiente de decisión legal y de seguridad.",
		next: "Definir cuándo notificar, cuándo diferir por obligación legal y cómo registrar la razón de no notificar.",
	},
	{
		title: "Registro auditable",
		status: "no-iniciado",
		where: "Pendiente de modelo de datos y almacenamiento.",
		next: "Registrar id, fecha, jurisdicción, tipo, decisión, base legal, datos entregados y vínculo con reporte de transparencia.",
	},
	{
		title: "Escalado y rechazo",
		status: "no-iniciado",
		where: "Pendiente de gobernanza.",
		next: "Definir quién decide en casos de alto riesgo, solicitudes abusivas, censura, persecución o riesgo para comunidades vulnerables.",
	},
];

export function AuthorityRequestsPage() {
	return (
		<PageShell
			title="Respuesta a autoridades"
			subtitle="Paso B del marco GNI: cómo evaluar solicitudes legales, gubernamentales o regulatorias."
			standards={["GNI Paso B", "Derechos humanos"]}
			declaration="commitment"
			breadcrumb={[{ label: "Inicio", href: "/" }, { label: "Valores", href: "/values" }, { label: "Autoridades" }]}
		>
			<p>
				Esta página describe qué debe existir antes de considerar madura una política de respuesta a autoridades. No afirma que ADC ya
				cuente con un proceso completo; funciona como checklist público y trazable.
			</p>

			<adc-callout tone="warning" role="note">
				Mientras el proceso dedicado no esté cerrado, las solicitudes o reportes relacionados se reciben por{" "}
				<a href="/contact">contacto</a> y se documentarán caso por caso.
			</adc-callout>

			<section className="mt-8">
				<h2 className="text-2xl font-heading mb-3">Qué se debe definir</h2>
				<ul className="space-y-4">
					{WORK_ITEMS.map((item) => (
						<li key={item.title} className="border-l-2 pl-3">
							<div className="flex flex-wrap items-center gap-2">
								<strong>{item.title}</strong>
								<adc-badge color={STATUS_COLOR[item.status]}>{STATUS_LABEL[item.status]}</adc-badge>
							</div>
							<p className="mt-1 text-sm opacity-80">
								<strong>Dónde está:</strong> {item.where}
							</p>
							<p className="mt-1">
								<strong>Qué falta:</strong> {item.next}
							</p>
						</li>
					))}
				</ul>
			</section>

			<section className="mt-10">
				<h2 className="text-2xl font-heading mb-3">Relación con transparencia</h2>
				<p>
					Cada solicitud relevante debería alimentar el <a href="/transparency">reporte de transparencia</a> con métricas agregadas,
					decisiones tomadas y límites de divulgación cuando publicar detalle pueda poner a alguien en riesgo.
				</p>
			</section>
		</PageShell>
	);
}
