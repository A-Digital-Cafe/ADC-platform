import { createAdcApi } from "@ui-library/utils/adc-fetch";
import type { LegalOverview, LegalRunsPage } from "@common/types/legal/index.ts";

export type { LegalAdoption, LegalDocOverview, LegalRun, LegalRunKind, LegalOverview } from "@common/types/legal/index.ts";

const api = createAdcApi({ basePath: "/api/legal/admin", devPort: 3000 });

/**
 * Igual que `plans-api.ts`: todo va `silent` porque esta app no monta `adc-custom-error` y el
 * error se perdería sin que nadie lo vea. El mensaje del backend se devuelve para pintarlo.
 */
export interface MutationResult {
	ok: boolean;
	error?: string;
}

export interface PdfBuildResult {
	ok: boolean;
	written: string[];
	skipped: string[];
	durationMs: number;
}

const fail = (res: { errorKey?: string; message?: string }): MutationResult => ({ ok: false, error: res.message ?? res.errorKey });

/** Estado de los cuatro documentos en el nodo que responde; `null` si no se pudo leer. */
export async function fetchOverview(): Promise<LegalOverview | null> {
	const res = await api.get<LegalOverview>("/overview", { silent: true });
	return res.success && res.data ? res.data : null;
}

export async function fetchRuns(cursor?: string): Promise<LegalRunsPage | null> {
	const res = await api.get<LegalRunsPage>("/runs", { params: cursor ? { cursor } : undefined, silent: true });
	return res.success && res.data ? res.data : null;
}

/** Genera los PDF faltantes. Idempotente, así que reintentar no rompe nada. */
export async function buildPdfs(): Promise<MutationResult & { result?: PdfBuildResult }> {
	const res = await api.post<PdfBuildResult>("/pdf/build", { body: {}, silent: true });
	return res.success ? { ok: true, result: res.data } : fail(res);
}

/** Regenera un PDF congelado. El motivo queda en el audit log y en el historial. */
export async function rebuildPdf(docId: string, reason: string): Promise<MutationResult> {
	const res = await api.post("/pdf/rebuild", { body: { docId, reason }, silent: true });
	return res.success ? { ok: true } : fail(res);
}

/** Re-dispara el aviso de cambio de versión. `NotificationService` deduplica la doble entrega. */
export async function announceDoc(docId: string): Promise<MutationResult> {
	const res = await api.post("/announce", { body: { docId }, silent: true });
	return res.success ? { ok: true } : fail(res);
}
