import type { BreachDataCategory, BreachRiskLevel, BreachState } from "@common/types/security/Breach.ts";

/**
 * Rótulos y ayuda del asistente. Viven en un módulo aparte y no en el panel porque son el
 * procedimiento escrito: cada paso dice qué hay que hacer y por qué, que es lo que diferencia
 * un asistente guiado de un formulario.
 */

export const STATE_LABEL: Record<BreachState, string> = {
	detected: "Detectado",
	assessing: "En evaluación",
	contained: "Contenido",
	registered: "Registrado",
	authority_notified: "Notificado a la autoridad",
	subjects_notified: "Personas avisadas",
	no_notification: "Sin notificación (fundamentado)",
	closed: "Cerrado",
};

type BadgeColor = "gray" | "red" | "orange" | "yellow" | "green" | "teal" | "blue" | "indigo" | "purple" | "pink";

export const STATE_COLOR: Record<BreachState, BadgeColor> = {
	detected: "red",
	assessing: "orange",
	contained: "yellow",
	registered: "blue",
	authority_notified: "indigo",
	subjects_notified: "teal",
	no_notification: "gray",
	closed: "green",
};

export const SOURCE_LABEL: Record<string, string> = {
	internal: "Detección interna",
	report: "Reporte de un tercero",
	provider: "Aviso de un proveedor",
	authority: "Requerimiento de autoridad",
};

export const CATEGORY_LABEL: Record<BreachDataCategory, string> = {
	identity: "Identificación",
	credentials: "Credenciales",
	contact: "Contacto",
	mail: "Correo",
	files: "Archivos",
	billing: "Facturación",
	usage: "Uso y actividad",
	other: "Otras",
};

export const CATEGORY_KEYS: BreachDataCategory[] = Object.keys(CATEGORY_LABEL) as BreachDataCategory[];

/** Severidad y probabilidad: van al punto 6 de la notificación a la autoridad y al paquete de export. */
export const RISK_LEVEL_LABEL: Record<BreachRiskLevel, string> = {
	low: "Baja",
	medium: "Media",
	high: "Alta",
};

export const RISK_LEVEL_KEYS: BreachRiskLevel[] = Object.keys(RISK_LEVEL_LABEL) as BreachRiskLevel[];

export const EXEMPTION_LABEL: Record<string, string> = {
	encrypted: "Los datos eran ininteligibles (cifrados)",
	measures_taken: "Se tomaron medidas que eliminan el riesgo alto",
	disproportionate_effort: "Esfuerzo desproporcionado (exige comunicación pública)",
};

/** Qué hay que hacer en cada paso, en una línea. Es el runbook dentro de la pantalla. */
export const STEP_HELP: Partial<Record<BreachState, string>> = {
	detected: "Describí qué pasó con lo que sepas ahora. El reloj de 72 h ya corre desde la fecha de detección.",
	assessing:
		"Contené primero, entendé después. Registrá al menos una medida y fijá qué datos se alcanzaron, las consecuencias probables y el riesgo: marcar riesgo alto es lo que vuelve obligatorio avisar a las personas.",
	contained: "Escribí las medidas correctivas. Al registrar, el incidente existe formalmente aunque después no se notifique.",
	registered:
		"Notificá a la autoridad con el borrador de la izquierda y pegá el texto tal como lo enviaste, o cerrá sin notificar fundamentando por qué.",
	authority_notified: "Si el riesgo es alto, cargá la audiencia y avisá a las personas afectadas; si no, cerrá el incidente.",
	subjects_notified: "Ya está todo notificado: cerrá el incidente.",
	no_notification: "Decisión registrada. Cerrá el incidente.",
};
