import type { FeatureDef } from "../../utils/plans-api.ts";

/**
 * Nombres legibles de las features del catálogo, para no administrar planes leyendo
 * claves técnicas (`drive.maxFileSize`).
 *
 * El catálogo identifica cada feature por su clave y un `label` que es una **clave i18n**
 * (`plans.features.drive.maxFileSize`). La página pública de precios resuelve esa clave
 * contra el diccionario de `adc-subscriptions`; este panel es admin, monolingüe y vive en
 * otro repo de preset, así que la resuelve contra la tabla de acá. Una feature nueva sin
 * entrada cae a su clave técnica, que es fea a propósito: se nota y se agrega la línea.
 */

/** Aplicación dueña de cada grupo, en el orden en que conviene leerlos. */
const MODULE_ORDER: readonly string[] = ["platform", "adc-drive", "adc-mail", "adc-project-manager", "adc-image-editor"];

const MODULE_LABELS: Record<string, string> = {
	platform: "Cuenta",
	"adc-drive": "Drive",
	"adc-mail": "Correo",
	"adc-project-manager": "Proyectos",
	"adc-image-editor": "Editor de imágenes",
};

/** Texto por clave i18n declarada en `FeatureDef.label`. */
const FEATURE_LABELS: Record<string, string> = {
	"plans.features.org.seats": "Asientos incluidos",
	"plans.features.storage.total": "Almacenamiento total",
	"plans.features.drive.maxFileSize": "Tamaño máximo por archivo",
	"plans.features.drive.maxDevices": "Dispositivos vinculados",
	"plans.features.drive.maxRemoteUnits": "Unidades remotas",
	"plans.features.drive.maxTunnelTransfers": "Transferencias simultáneas",
	"plans.features.drive.egressPerMonth": "Descarga por mes",
	"plans.features.drive.tunnelPerMonth": "Transferencia entre dispositivos por mes",
	"plans.features.email.storage": "Almacenamiento de correo",
	"plans.features.email.dailySend": "Envíos por día",
	"plans.features.email.maxAttachment": "Adjunto máximo",
	"plans.features.email.maxAccounts": "Casillas",
	"plans.features.email.maxRecipients": "Destinatarios por envío",
	"plans.features.email.maxScheduled": "Envíos programados",
	"plans.features.pm.maxProjects": "Proyectos",
	"plans.features.pm.maxIssues": "Incidencias por proyecto",
	"plans.features.pm.maxSprints": "Sprints por proyecto",
	"plans.features.pm.maxMilestones": "Hitos por proyecto",
	"plans.features.imageEditor.exportsPerMonth": "Exportaciones por mes",
	"plans.features.imageEditor.exportsPerDay": "Exportaciones por día",
	"plans.features.imageEditor.resolution": "Resolución de exportación",
	"plans.features.imageEditor.bgRemoval": "Quitar fondo por mes",
	"plans.features.imageEditor.bgRemovalDaily": "Quitar fondo por día",
	"plans.features.imageEditor.stickerGen": "Stickers por mes",
	"plans.features.imageEditor.blur": "Desenfoque",
	"plans.features.imageEditor.assets": "Recursos",
	"plans.features.imageEditor.transparency": "Transparencia (PNG/WEBP)",
	"plans.features.imageEditor.layers": "Capas por proyecto",
	"plans.features.imageEditor.undo": "Niveles de deshacer",
};

const KIND_LABELS: Record<FeatureDef["kind"], string> = {
	quota: "Consumo",
	limit: "Tope",
	flag: "Sí/No",
	enum: "Variante",
};

const WINDOW_LABELS: Record<string, string> = { day: "por día", month: "por mes", total: "acumulado" };
const UNIT_LABELS: Record<string, string> = { bytes: "en bytes", count: "en cantidad", px: "en píxeles" };

export function featureLabel(def: FeatureDef): string {
	return FEATURE_LABELS[def.label] ?? def.key;
}

/** Qué clase de límite es, para saber qué valor tiene sentido escribir. */
export function featureHint(def: FeatureDef): string {
	const parts = [KIND_LABELS[def.kind]];
	if (def.window) parts.push(WINDOW_LABELS[def.window] ?? def.window);
	if (def.unit) parts.push(UNIT_LABELS[def.unit] ?? def.unit);
	if (def.orgScaling === "perSeat") parts.push("escala por asiento");
	return parts.join(" · ");
}

export interface FeatureGroup {
	id: string;
	label: string;
	defs: FeatureDef[];
}

/**
 * Agrupa por aplicación dueña respetando `MODULE_ORDER` y dejando al final los módulos
 * que todavía no estén declarados ahí (los registra un preset nuevo).
 */
export function groupByModule(defs: readonly FeatureDef[]): FeatureGroup[] {
	const byModule = new Map<string, FeatureDef[]>();
	for (const def of defs) {
		const list = byModule.get(def.module);
		if (list) list.push(def);
		else byModule.set(def.module, [def]);
	}
	for (const list of byModule.values()) list.sort((a, b) => featureLabel(a).localeCompare(featureLabel(b)));

	const groupOf = (id: string): FeatureGroup => ({ id, label: MODULE_LABELS[id] ?? id, defs: byModule.get(id) as FeatureDef[] });
	const groups = MODULE_ORDER.filter((id) => byModule.has(id)).map(groupOf);
	const known = new Set(MODULE_ORDER);
	for (const id of byModule.keys()) {
		if (!known.has(id)) groups.push(groupOf(id));
	}
	return groups;
}

/** Opciones para un combobox de features: se puede tipear tanto el nombre como la clave. */
export function featureOptions(defs: readonly FeatureDef[]): { value: string; label: string }[] {
	return groupByModule(defs).flatMap((group) =>
		group.defs.map((def) => ({ value: def.key, label: `${group.label} · ${featureLabel(def)} — ${def.key}` }))
	);
}
