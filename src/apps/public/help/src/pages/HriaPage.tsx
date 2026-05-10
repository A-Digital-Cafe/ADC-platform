import "@ui-library/utils/react-jsx";
import PageShell from "../components/PageShell";

type Status = "en-redaccion" | "planificado" | "no-iniciado";

interface HriaItem {
	id: string;
	question: string;
	status: Status;
	needed: string;
}

interface HriaSection {
	title: string;
	intro: string;
	items: HriaItem[];
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

const SECTIONS: HriaSection[] = [
	{
		title: "1. Gobernanza y alcance",
		intro: "Definir qué cubre el HRIA, quién lo aprueba y cómo se mantiene vivo en el tiempo.",
		items: [
			{
				id: "q001",
				question:
					"Alcance del HRIA definido (unidades, países, operaciones, productos/servicios, cadena de valor, horizonte temporal) y aprobado por liderazgo.",
				status: "en-redaccion",
				needed: "Cerrar inventario de productos, servicios, países y operaciones cubiertas, y dejar aprobación fechada por liderazgo.",
			},
			{
				id: "q002",
				question: "Gobernanza clara del HRIA: responsable, decisores, escalado, documentación e independencia.",
				status: "en-redaccion",
				needed: "Nombrar responsable, revisores y criterios de escalado; documentar cómo se evita una revisión puramente informal.",
			},
			{
				id: "q017",
				question: "HRIA documentado con supuestos, fuentes de evidencia, inputs de stakeholders, decisiones y aprobaciones.",
				status: "planificado",
				needed: "Vincular evidencias, fuentes, decisiones y aprobaciones en un registro interno trazable.",
			},
			{
				id: "q019",
				question:
					"Refresco periódico del HRIA y disparadores ante cambios significativos (mercados, features, incidentes, marcos legales).",
				status: "planificado",
				needed: "Definir periodicidad de revisión y eventos que obligan a reabrir la evaluación.",
			},
			{
				id: "q020",
				question: "Proceso de escalado para riesgos de alta severidad (decisiones stop/go, supervisión, respuesta de emergencia).",
				status: "no-iniciado",
				needed: "Crear matriz de severidad y circuito de decisión para pausar, limitar o rediseñar funciones de alto riesgo.",
			},
		],
	},
	{
		title: "2. Stakeholders y participación",
		intro: "Identificar a las personas titulares de derechos y construir un diálogo seguro con ellas.",
		items: [
			{
				id: "q003",
				question:
					"Identificación de titulares de derechos y stakeholders relevantes (usuarios, equipo, comunidades, grupos vulnerables, sociedad civil, reguladores).",
				status: "en-redaccion",
				needed: "Completar mapa de stakeholders por tipo de uso, región y vulnerabilidad, incluyendo canales de contacto seguros.",
			},
			{
				id: "q004",
				question: "Engagement significativo, seguro, inclusivo, accesible y sin represalias, con limitaciones documentadas.",
				status: "planificado",
				needed: "Diseñar proceso de consulta con privacidad, accesibilidad, consentimiento y protección frente a represalias.",
			},
		],
	},
	{
		title: "3. Áreas de impacto en derechos humanos",
		intro: "Las cuatro dimensiones que ADC evalúa de forma continua mientras la plataforma evoluciona.",
		items: [
			{
				id: "q005",
				question: "Impactos sobre libertad de expresión: moderación, restricciones, solicitudes de censura, interrupción de servicio.",
				status: "planificado",
				needed: "Definir criterios para moderación, restricciones y solicitudes de retiro, con vías de apelación y registro.",
			},
			{
				id: "q006",
				question:
					"Impactos sobre privacidad: recolección, vigilancia, compartición, retención, perfilado, seguridad y acceso gubernamental.",
				status: "en-redaccion",
				needed: "Cerrar inventario de datos, bases legales, retención, accesos internos, subprocesadores y escenarios de solicitud estatal.",
			},
			{
				id: "q007",
				question: "Riesgos de discriminación e impacto desigual: sesgos, accesibilidad, idioma, discapacidad, minorías.",
				status: "en-redaccion",
				needed: "Revisar idioma, accesibilidad, sesgos de diseño y posibles barreras para grupos vulnerables o minoritarios.",
			},
			{
				id: "q008",
				question: "Riesgos de seguridad personal: doxxing, acoso, targeting, riesgo de detención por divulgación de datos.",
				status: "planificado",
				needed: "Mapear amenazas concretas, medidas antiabuso, respuesta a doxxing o acoso y límites de divulgación de datos sensibles.",
			},
		],
	},
	{
		title: "4. Análisis, contexto y solicitudes de autoridades",
		intro: "Cómo se priorizan los impactos y cómo se manejan solicitudes legales o gubernamentales.",
		items: [
			{
				id: "q009",
				question: "Severidad (escala, alcance, irremediabilidad) y probabilidad evaluadas para cada impacto.",
				status: "planificado",
				needed: "Crear escala de severidad y probabilidad, y aplicarla a cada impacto con evidencia y criterio de priorización.",
			},
			{
				id: "q010",
				question: "Contexto legal/regulatorio relevante y conflictos con estándares internacionales de derechos humanos.",
				status: "planificado",
				needed: "Relevar jurisdicciones relevantes, conflictos legales y estándares internacionales aplicables a cada riesgo.",
			},
			{
				id: "q011",
				question:
					"Procesos para solicitudes gubernamentales/legales: legitimidad, necesidad, proporcionalidad, transparencia y remedio.",
				status: "no-iniciado",
				needed: "Conectar este punto con /authority-requests: canal, verificación, proporcionalidad, minimización, notificación y registro.",
			},
		],
	},
	{
		title: "5. Remedio, cadena de valor y diseño de producto",
		intro: "Mecanismos para reparar impactos y para incorporar derechos humanos a las decisiones técnicas.",
		items: [
			{
				id: "q012",
				question: "Mecanismos de queja y remedio accesibles a personas afectadas, con vías de apelación.",
				status: "en-redaccion",
				needed: "Definir flujo de quejas, tiempos de respuesta, apelación, evidencia mínima y cierre documentado.",
			},
			{
				id: "q013",
				question: "Cobertura de proveedores, intermediarios y partners (due diligence, palanca, mitigación o terminación).",
				status: "no-iniciado",
				needed: "Identificar proveedores y partners, evaluar riesgos y definir cláusulas, salida o mitigación cuando no cumplan estándares.",
			},
			{
				id: "q014",
				question: "Riesgos considerados en decisiones de diseño: privacy by design, safety by design, decisiones UX.",
				status: "en-redaccion",
				needed: "Convertir riesgos en requisitos de producto, privacidad, seguridad, accesibilidad y UX revisables antes de cambios relevantes.",
			},
		],
	},
	{
		title: "6. Mitigación, seguimiento y transparencia",
		intro: "Cerrar el ciclo: actuar, medir y comunicar.",
		items: [
			{
				id: "q015",
				question: "Medidas de mitigación con responsables, plazos y reducción de riesgo esperada, priorizando impactos severos.",
				status: "planificado",
				needed: "Asignar responsable, plazo, medida concreta y señal de reducción de riesgo para cada impacto priorizado.",
			},
			{
				id: "q016",
				question: "Seguimiento de implementación y efectividad: KPIs, auditorías, monitoreo, feedback loops.",
				status: "planificado",
				needed: "Definir KPIs, revisión periódica, auditoría interna y mecanismo de feedback para verificar efectividad.",
			},
			{
				id: "q018",
				question:
					"Comunicación de resultados del HRIA: reporte público cuando es viable, interno cuando no, con justificación de redacciones.",
				status: "planificado",
				needed: "Decidir formato público o interno, criterios de redacción y vínculo con /transparency para comunicar sin crear riesgos.",
			},
		],
	},
];

export function HriaPage() {
	return (
		<PageShell
			title="Evaluación de Impacto en Derechos Humanos (HRIA)"
			subtitle="Paso A del marco GNI: qué evaluamos y en qué estado está cada bloque."
			standards={["GNI HRIA"]}
			declaration="commitment"
			breadcrumb={[{ label: "Inicio", href: "/" }, { label: "Valores", href: "/values" }, { label: "HRIA" }]}
		>
			<p>
				Esta página es la versión pública resumida del HRIA de Abby's Digital Cafe. Sigue el marco{" "}
				<a href="https://globalnetworkinitiative.org/" rel="noreferrer">
					Global Network Initiative
				</a>{" "}
				y se refresca conforme avanza el trabajo interno. Cada bloque indica el estado real, sin prometer madurez que no exista.
			</p>

			<adc-callout tone="info" role="note">
				Los estados <em>En redacción</em>, <em>Planificado</em> y <em>No iniciado</em> corresponden al momento indicado al pie de la
				página y se revisan periódicamente.
			</adc-callout>

			{SECTIONS.map((section) => (
				<section key={section.title} className="mt-8">
					<h2 className="text-2xl font-heading mb-1">{section.title}</h2>
					<p className="opacity-80 mb-3">{section.intro}</p>
					<ul className="space-y-3">
						{section.items.map((item) => (
							<li key={item.id} className="border-l-2 pl-3">
								<div className="flex flex-wrap items-center gap-2">
									<adc-badge color="indigo">{item.id}</adc-badge>
									<adc-badge color={STATUS_COLOR[item.status]}>{STATUS_LABEL[item.status]}</adc-badge>
								</div>
								<p className="mt-1">{item.question}</p>
								<p className="mt-1 text-sm opacity-80">
									<strong>Qué falta hacer:</strong> {item.needed}
								</p>
							</li>
						))}
					</ul>
				</section>
			))}

			<section className="mt-10">
				<h2 className="text-2xl font-heading mb-3">Relación con el mapa GNI</h2>
				<p>
					El HRIA es el Paso A. El mapa completo con enlaces al Paso B (respuesta a autoridades) y Paso C (transparencia) está en{" "}
					<a href="/values">/values</a>.
				</p>
				<p>
					Para reportar impactos en derechos humanos o conductas contrarias a los <a href="/values">valores</a>, usa los canales de{" "}
					<a href="/contact">contacto</a>.
				</p>
			</section>
		</PageShell>
	);
}
