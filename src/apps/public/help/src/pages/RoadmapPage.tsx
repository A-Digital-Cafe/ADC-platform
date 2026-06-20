import "@ui-library/utils/react-jsx";
import PageShell from "../components/PageShell";

interface Item {
	title: string;
	status: "done" | "fase-1" | "siguiente" | "futuro";
	notes: string;
	links?: ReadonlyArray<{ label: string; href: string }>;
}

const LAYERS: Array<{ id: string; name: string; description: string; items: Item[] }> = [
	{
		id: "capa-etica-legal-cimientos",
		name: "Capa Ética/Legal (Cimientos)",
		description: "Base usable globalmente y respetuosa.",
		items: [
			{
				title: "Valores + marco GNI + espacio seguro",
				status: "done",
				notes: "Página de valores publicada.",
				links: [{ label: "Valores", href: "/values" }],
			},
			{
				title: "GDPR básico + privacidad/cookies/términos",
				status: "done",
				notes: "Páginas de privacidad, cookies y términos publicadas.",
				links: [
					{ label: "Privacidad", href: "/privacy" },
					{ label: "Cookies", href: "/cookies" },
					{ label: "Términos", href: "/terms" },
				],
			},
			{
				title: "Código de ética + ISO/IEC 17050-1 (compromiso)",
				status: "done",
				notes: "Página de ética publicada.",
				links: [{ label: "Ética", href: "/ethics" }],
			},
			{
				title: "GNI HRIA — Paso A (Evaluación de Impacto)",
				status: "fase-1",
				notes: "Página HRIA publicada con estado por bloque; contenido en redacción.",
				links: [{ label: "HRIA", href: "/hria" }],
			},
			{
				title: "GNI — Paso B (respuesta a autoridades)",
				status: "fase-1",
				notes: "Página de respuesta a autoridades publicada como checklist; proceso operativo pendiente.",
				links: [{ label: "Autoridades", href: "/authority-requests" }],
			},
			{
				title: "GNI — Paso C (transparencia)",
				status: "fase-1",
				notes: "Página de transparencia publicada como estructura; primer reporte periódico pendiente.",
				links: [{ label: "Transparencia", href: "/transparency" }],
			},
			{
				title: "Geofiltro y avisos por país",
				status: "done",
				notes: "Filtro aplicado desde cloudflare.",
				links: [{ label: "Geofiltro activo", href: "/values#geofiltro-activo" }],
			},
		],
	},
	{
		id: "capa-de-ingenieria-construccion",
		name: "Capa de Ingeniería (Construcción)",
		description: "Calidad de código y accesibilidad.",
		items: [
			{
				title: "ISO 25010:2023 — calidad de software",
				status: "siguiente",
				notes: "Definir métricas verificables por cada característica.",
			},
			{
				title: "WCAG 2.1 AA",
				status: "siguiente",
				notes: "Auditoría de componentes y páginas; revisión de UI library.",
				links: [{ label: "Accesibilidad e inclusión", href: "/ethics#accesibilidad-e-inclusion" }],
			},
		],
	},
	{
		id: "capa-de-blindaje-seguridad",
		name: "Capa de Blindaje (Seguridad)",
		description: "Protección frente a amenazas.",
		items: [
			{
				title: "OWASP ASVS Nivel 1",
				status: "siguiente",
				notes: "Checklist alineada con los requisitos de seguridad.",
				links: [{ label: "Seguridad", href: "/privacy#seguridad" }],
			},
			{ title: "OWASP ASVS Nivel 2", status: "futuro", notes: "Tras cierre del nivel 1." },
			{ title: "ISO 27001 (referencia)", status: "futuro", notes: "Adopción gradual de controles, sin certificación inicial." },
			{ title: "SOC 2 Type 1 (referencia)", status: "futuro", notes: "Requiere alcance formal y fecha; planificación posterior." },
		],
	},
	{
		id: "capa-de-transparencia-operaciones",
		name: "Capa de Transparencia (Operaciones)",
		description: "Visibilidad pública del estado y la mejora continua.",
		items: [
			{ title: "SLA/SLO + Status Page", status: "futuro", notes: "Subdominio status/health con incidentes reales." },
			{
				title: "Publicidad en games",
				status: "siguiente",
				notes: "Decisión tomada; resta definir proveedor, modalidad técnica, consentimiento y documentación separada.",
				links: [
					{ label: "Cookies opcionales", href: "/cookies#cookies-opcionales" },
					{ label: "Subdominios", href: "/terms#subdominios-con-reglas-propias" },
				],
			},
			{
				title: "Bug Bounty con tickets públicos (id, fecha, hash, estado)",
				status: "done",
				notes:
					"Log público de transparencia en vivo (id, fecha/hora, hash SHA-256 y estado) y recompensas con beneficios temporales escalonados según severidad; reportes por ticket de Seguridad. Política publicada.",
				links: [
					{ label: "Log de transparencia", href: "https://status.adigitalcafe.com/status/bounty" },
					{ label: "Política de seguridad", href: "https://github.com/A-Digital-Cafe/ADC-platform/blob/main/.github/SECURITY.md" },
				],
			},
			{ title: "ISO 9001 (referencia)", status: "futuro", notes: "Gestión de calidad continua." },
		],
	},
];

const STATUS_COLOR = {
	done: "green",
	"fase-1": "yellow",
	siguiente: "blue",
	futuro: "gray",
} as const satisfies Record<Item["status"], "gray" | "red" | "orange" | "yellow" | "green" | "teal" | "blue" | "indigo" | "purple" | "pink">;

const STATUS_LABEL: Record<Item["status"], string> = {
	done: "Fase 2 (finalizado)",
	"fase-1": "Fase 1 (en desarrollo)",
	siguiente: "Próxima fase",
	futuro: "Futuro",
};

/** Relativo → enlace SPA interno; adigitalcafe → chip de plataforma; resto → enlace externo. */
function renderRoadmapLink(href: string, label: string) {
	if (!/^https?:\/\//i.test(href)) return <a href={href}>{label}</a>;
	if (/\/\/[^/]*adigitalcafe\.com/i.test(href)) return <adc-platform-link href={href}>{label}</adc-platform-link>;
	return <adc-external-link href={href}>{label}</adc-external-link>;
}

export function RoadmapPage() {
	return (
		<PageShell
			title="Roadmap de cumplimiento"
			subtitle="Plan público por capas, agrupado para no duplicar trabajo."
			declaration="informational"
			breadcrumb={[{ label: "Inicio", href: "/" }, { label: "Roadmap" }]}
		>
			<p>
				Avanzamos por capas: primero la base ética/legal, luego ingeniería, blindaje y transparencia operativa. La intención es comunicar
				honestamente qué hay hoy, qué sigue y qué queda para más adelante.
			</p>

			{LAYERS.map((layer) => (
				<section key={layer.name} className="mt-8">
					<h2 id={layer.id} className="text-2xl font-heading mb-1">
						{layer.name}
					</h2>
					<p className="opacity-80 mb-3">{layer.description}</p>
					<ul className="space-y-3">
						{layer.items.map((item) => (
							<li key={item.title} className="border-l-2 pl-3">
								<div className="flex flex-wrap items-center gap-2">
									<strong>{item.title}</strong>
									<adc-badge color={STATUS_COLOR[item.status]}>{STATUS_LABEL[item.status]}</adc-badge>
								</div>
								<p className="text-sm opacity-80">{item.notes}</p>
								{item.links && item.links.length > 0 && (
									<p className="text-sm">
										<strong>Ver:</strong>{" "}
										{item.links.map((link, index) => (
											<span key={link.href}>
												{index > 0 ? " · " : ""}
												{renderRoadmapLink(link.href, link.label)}
											</span>
										))}
									</p>
								)}
							</li>
						))}
					</ul>
				</section>
			))}

			<adc-callout tone="info" role="note">
				Las menciones a estándares externos describen un compromiso de trabajo y referencias de diseño, no una certificación obtenida.
			</adc-callout>
		</PageShell>
	);
}
