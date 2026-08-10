import { createAdcApi } from "@ui-library/utils/adc-fetch";
import type { BreachOpenInput, BreachRecord, BreachState, BreachSummary, BreachTransitionInput } from "@common/types/security/Breach.ts";

export type { BreachOpenInput, BreachRecord, BreachState, BreachSummary, BreachTransitionInput };

const api = createAdcApi({ basePath: "/api/security", devPort: 3000 });

/**
 * Todas las llamadas van en `silent` porque esta app no monta `adc-custom-error`: el mensaje del
 * backend se devuelve para pintarlo donde ocurrió. Mismo criterio que `plans-api`.
 */
export interface MutationResult<T = undefined> {
	ok: boolean;
	data?: T;
	error?: string;
}

const fail = (res: { errorKey?: string; message?: string }): MutationResult<never> => ({ ok: false, error: res.message ?? res.errorKey });

export async function listBreaches(state?: BreachState): Promise<BreachSummary[]> {
	const res = await api.get<{ items: BreachSummary[] }>("/breaches", { params: state ? { state } : undefined, silent: true });
	return res.success && res.data ? res.data.items : [];
}

export async function getBreach(id: string): Promise<BreachRecord | null> {
	const res = await api.get<BreachRecord>(`/breaches/${encodeURIComponent(id)}`, { silent: true });
	return res.success && res.data ? res.data : null;
}

export async function openBreach(input: BreachOpenInput): Promise<MutationResult<BreachRecord>> {
	const res = await api.post<BreachRecord>("/breaches", { body: input, silent: true });
	return res.success ? { ok: true, data: res.data } : fail(res);
}

export async function transitionBreach(id: string, input: BreachTransitionInput): Promise<MutationResult<BreachRecord>> {
	const res = await api.post<BreachRecord>(`/breaches/${encodeURIComponent(id)}/transition`, { body: input, silent: true });
	return res.success ? { ok: true, data: res.data } : fail(res);
}

export async function annotateBreach(id: string, note: string): Promise<MutationResult<BreachRecord>> {
	const res = await api.post<BreachRecord>(`/breaches/${encodeURIComponent(id)}/note`, { body: { note }, silent: true });
	return res.success ? { ok: true, data: res.data } : fail(res);
}

export async function setAudience(id: string, userIds: string[]): Promise<MutationResult<{ audienceSize: number }>> {
	const res = await api.put<{ audienceSize: number }>(`/breaches/${encodeURIComponent(id)}/audience`, { body: { userIds }, silent: true });
	return res.success ? { ok: true, data: res.data } : fail(res);
}

/** `recipients` son entregas confirmadas, `queued` lo que quedó en la cola y `pending` lo reintentable. */
export interface BreachNotifyResult {
	recipients: number;
	queued: number;
	pending: number;
}

export async function notifySubjects(id: string, body?: string): Promise<MutationResult<BreachNotifyResult>> {
	const res = await api.post<BreachNotifyResult>(`/breaches/${encodeURIComponent(id)}/notify-subjects`, {
		body: { body },
		silent: true,
	});
	return res.success ? { ok: true, data: res.data } : fail(res);
}

export interface BreachTemplates {
	authority: string;
	subjects: { title: string; body: string };
	publicCommunication: string;
}

export async function fetchTemplates(id: string): Promise<BreachTemplates | null> {
	const res = await api.get<BreachTemplates>(`/breaches/${encodeURIComponent(id)}/templates`, { silent: true });
	return res.success && res.data ? res.data : null;
}

export interface AuditEntry {
	id: string;
	at: string;
	origin: string;
	action: string;
	actorUserId: string;
	targetUserId?: string;
	targetResource?: string;
	context?: Record<string, string | number | boolean | null>;
}

export async function listAudit(action?: string): Promise<AuditEntry[]> {
	const res = await api.get<{ items: AuditEntry[] }>("/audit-log", { params: action ? { action } : undefined, silent: true });
	return res.success && res.data ? res.data.items : [];
}
