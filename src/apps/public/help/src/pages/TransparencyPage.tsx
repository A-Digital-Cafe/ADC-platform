import "@ui-library/utils/react-jsx";
import PageShell from "../components/PageShell";

type Status = "aplicado" | "en-redaccion" | "planificado" | "no-iniciado";

interface ReportItem {
	title: string;
	status: Status;
	metric: string;
	needed: string;
}

const STATUS_LABEL: Record<Status, string> = {
	aplicado: "Aplicado",
	"en-redaccion": "En redacción",
	planificado: "Planificado",
	"no-iniciado": "No iniciado",
};

const STATUS_COLOR = {
	aplicado: "green",
	"en-redaccion": "yellow",
	planificado: "blue",
	"no-iniciado": "gray",
} as const satisfies Record<Status, "gray" | "red" | "orange" | "yellow" | "green" | "teal" | "blue" | "indigo" | "purple" | "pink">;

const REPORT_ITEMS: ReportItem[] = [
	{
		title: "Solicitudes de autoridades",
		status: "planificado",
		metric: "Cantidad recibida, aceptada, rechazada o parcialmente respondida, por tipo y jurisdicción cuando sea seguro publicarlo.",
		needed: "Depende del registro auditable definido en /authority-requests.",
	},
	{
		title: "Moderación y reportes comunitarios",
		status: "planificado",
		metric: "Reportes recibidos, categorías generales, medidas tomadas y apelaciones cuando exista el flujo.",
		needed: "Definir canal dedicado y categorías estables de reporte.",
	},
	{
		title: "Derechos de privacidad",
		status: "planificado",
		metric: "Solicitudes de acceso, rectificación, supresión, limitación, oposición o portabilidad en forma agregada.",
		needed: "Cerrar el flujo público de derechos GDPR indicado en /privacy.",
	},
	{
		title: "Geofiltro y seguridad por país",
		status: "aplicado",
		metric: "Cambios relevantes en la lista de países bloqueados, motivos generales y revisión de contexto.",
		needed: "Lista publicada en /values y sincronizada con la regla activa de Cloudflare. Revisar periódicamente si el contexto de algún país cambia.",
	},
	{
		title: "Incidentes y disponibilidad",
		status: "no-iniciado",
		metric: "Incidentes relevantes, impacto, duración, causa general y acciones posteriores.",
		needed: "Crear status page/SLA antes de publicar métricas operativas consistentes.",
	},
	{
		title: "Seguridad y bug bounty",
		status: "planificado",
		metric: "Reportes de vulnerabilidades recibidos, estados y tiempos de respuesta en forma agregada.",
		needed: "Crear tickets públicos con id, fecha, hash y estado.",
	},
	{
		title: "Publicidad en games",
		status: "planificado",
		metric: "Proveedor, modalidad técnica, consentimiento, cookies o identificadores si los hubiera.",
		needed: "Definir implementación publicitaria antes de activar documentación específica.",
	},
];

export function TransparencyPage() {
	return (
		<PageShell
			title="Reporte de transparencia"
			subtitle="Paso C del marco GNI: qué publicar, con qué métricas y qué falta cerrar."
			standards={["GNI Paso C", "Transparencia"]}
			declaration="commitment"
			breadcrumb={[{ label: "Inicio", href: "/" }, { label: "Valores", href: "/values" }, { label: "Transparencia" }]}
		>
			<p>
				Esta página define la estructura mínima de un reporte periódico. Todavía no sustituye un reporte emitido: muestra qué métricas
				deben existir y qué dependencias faltan para publicarlo con rigor.
			</p>

			<adc-callout tone="info" role="note">
				La transparencia debe equilibrar rendición de cuentas con seguridad de usuarios. Cuando publicar detalle pueda crear riesgo, el
				reporte debería usar agregados o redacciones justificadas.
			</adc-callout>

			<section className="mt-8">
				<h2 className="text-2xl font-heading mb-3">Métricas previstas</h2>
				<ul className="space-y-4">
					{REPORT_ITEMS.map((item) => (
						<li key={item.title} className="border-l-2 pl-3">
							<div className="flex flex-wrap items-center gap-2">
								<strong>{item.title}</strong>
								<adc-badge color={STATUS_COLOR[item.status]}>{STATUS_LABEL[item.status]}</adc-badge>
							</div>
							<p className="mt-1">
								<strong>Qué publicar:</strong> {item.metric}
							</p>
							<p className="mt-1 text-sm opacity-80">
								<strong>Qué falta:</strong> {item.needed}
							</p>
						</li>
					))}
				</ul>
			</section>

			<section className="mt-10">
				<h2 className="text-2xl font-heading mb-3">Cadencia pendiente</h2>
				<p>
					La cadencia del reporte (mensual, trimestral o semestral) todavía debe definirse. La decisión debería considerar volumen real
					de solicitudes, capacidad de revisión y riesgo de publicar datos demasiado granulares.
				</p>
			</section>
		</PageShell>
	);
}
