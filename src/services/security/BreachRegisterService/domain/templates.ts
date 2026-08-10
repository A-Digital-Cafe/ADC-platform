import type { BreachDataCategory, BreachRecord } from "@common/types/security/Breach.ts";

/**
 * Borradores derivados del registro. Son lo que convierte esto en un procedimiento y no en un
 * CRUD: quien instruye el incidente no arranca de una hoja en blanco a las 3 de la mañana.
 *
 * El panel los deja editar y guarda el texto final en `bodySnapshot`, que es la prueba de qué
 * se dijo — el borrador no lo es.
 */

const CATEGORY_LABELS: Record<BreachDataCategory, string> = {
	identity: "datos de identificación (nombre de usuario, identificador de cuenta)",
	credentials: "credenciales de acceso",
	contact: "datos de contacto (dirección de correo)",
	mail: "contenido de correo (mensajes y adjuntos)",
	files: "archivos almacenados en el Drive",
	billing: "datos de facturación",
	usage: "datos de uso y actividad",
	other: "otras categorías (ver descripción)",
};

function categories(list: BreachDataCategory[]): string {
	return list.length > 0 ? list.map((c) => CATEGORY_LABELS[c] ?? c).join("; ") : "(sin determinar)";
}

function approx(n: number | null, unit: string): string {
	return n === null ? `(número de ${unit} sin determinar)` : `aproximadamente ${n} ${unit}`;
}

function isoDate(d: Date | null): string {
	return d ? new Date(d).toISOString() : "(pendiente)";
}

/**
 * Notificación a la autoridad con la estructura del art. 33.3. Si la notificación sale fuera de
 * las 72 h, incorpora el párrafo de motivos de la demora que la política promete literalmente.
 */
export function buildAuthorityNotice(breach: BreachRecord, operatorName: string, contactEmail: string): string {
	const late = breach.authority.notifiedAt !== null && breach.authority.onTime === false;
	return [
		`NOTIFICACIÓN DE INCIDENTE DE SEGURIDAD QUE AFECTA DATOS PERSONALES`,
		`Referencia interna: ${breach.ref}`,
		`Responsable del tratamiento: ${operatorName}`,
		``,
		`1. Naturaleza del incidente (art. 33.3.a)`,
		breach.nature || "(pendiente)",
		`Fecha y hora en que se tomó conocimiento: ${isoDate(breach.detectedAt)}`,
		``,
		`2. Categorías de datos y de personas afectadas (art. 33.3.a)`,
		`Categorías de datos: ${categories(breach.dataCategories)}`,
		`Personas afectadas: ${approx(breach.approxSubjects, "personas")}`,
		`Registros afectados: ${approx(breach.approxRecords, "registros")}`,
		``,
		`3. Punto de contacto (art. 33.3.b)`,
		contactEmail,
		``,
		`4. Consecuencias probables (art. 33.3.c)`,
		breach.likelyConsequences || "(pendiente)",
		``,
		`5. Medidas adoptadas o propuestas (art. 33.3.d)`,
		breach.containment.length > 0 ? breach.containment.map((s) => `- ${isoDate(s.at)}: ${s.text}`).join("\n") : "- (pendiente)",
		breach.correctiveMeasures ? `\nMedidas correctivas: ${breach.correctiveMeasures}` : "",
		``,
		`6. Evaluación de riesgo`,
		`Severidad: ${breach.risk.severity} · Probabilidad: ${breach.risk.likelihood} · Riesgo alto para los derechos: ${breach.risk.highRisk ? "sí" : "no"}`,
		breach.risk.rationale || "(sin fundamentar)",
		late
			? `\n7. Motivos de la demora (art. 33.1 in fine)\n${breach.authority.delayReason || "(pendiente)"}`
			: `\n7. Plazo\nNotificación cursada dentro de las 72 horas desde que se tomó conocimiento.`,
	]
		.filter(Boolean)
		.join("\n");
}

/**
 * Aviso a las personas afectadas. Cubre exactamente los seis puntos que `/privacy` §11 promete:
 * qué pasó y cuándo, qué datos, consecuencias probables, qué hicimos, qué conviene hacer y a
 * quién escribir. El cuerpo va en lenguaje claro (art. 34.2): quien lo lee no es abogado.
 */
export function buildSubjectsNotice(breach: BreachRecord, contactEmail: string): { title: string; body: string } {
	return {
		title: "Un incidente de seguridad afectó datos tuyos",
		body: [
			`Qué pasó: ${breach.nature || "(pendiente)"}`,
			`Cuándo lo detectamos: ${isoDate(breach.detectedAt)}.`,
			`Qué datos tuyos alcanzó: ${categories(breach.dataCategories)}.`,
			`Qué puede implicar: ${breach.likelyConsequences || "(pendiente)"}`,
			`Qué hicimos: ${breach.containment.map((s) => s.text).join(" ") || "(pendiente)"} ${breach.correctiveMeasures}`.trim(),
			`Qué te recomendamos: si el incidente alcanzó credenciales, cambiá tu contraseña y cerrá las sesiones abiertas desde Mi cuenta. Desconfiá de cualquier mensaje que te pida datos a raíz de esto: nunca te vamos a pedir tu contraseña.`,
			`A quién escribir: ${contactEmail}. Referencia del incidente: ${breach.ref}.`,
		].join("\n\n"),
	};
}

/** Comunicación pública (art. 34.3.c) cuando avisar una por una exigiría un esfuerzo desproporcionado. */
export function buildPublicCommunication(breach: BreachRecord, contactEmail: string): string {
	return [
		`Incidente de seguridad ${breach.ref}.`,
		`${breach.nature || "(pendiente)"}`,
		`Datos alcanzados: ${categories(breach.dataCategories)}.`,
		`Consecuencias probables: ${breach.likelyConsequences || "(pendiente)"}`,
		`Medidas: ${breach.correctiveMeasures || "(pendiente)"}`,
		`Consultas: ${contactEmail}.`,
	].join(" ");
}
