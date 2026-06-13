import { createAdcApi } from "@ui-library/utils/adc-fetch";
import type { QuotaSubjectType, StorageAppInfo, StorageUsageSnapshot } from "@common/types/storage/quota.ts";

const api = createAdcApi({
	basePath: "/api/storage",
	devPort: 3000,
	credentials: process.env.NODE_ENV === "development" ? "include" : "same-origin",
});

export interface StorageOverride {
	id: string;
	subjectType: QuotaSubjectType;
	subjectId: string;
	orgId: string | null;
	limitBytes: number;
	createdBy: string;
	createdAt: string;
	updatedAt: string;
}

export interface OrgLimitsInfo {
	orgId: string;
	orgLimit: number;
	memberDefault: { tierBytes: number; overrideBytes: number | null; effectiveBytes: number };
}

export interface OrgMemberUsage {
	userId: string;
	username?: string;
	totalBytes: number;
	totalCount: number;
}

export interface OrgUsageInfo {
	orgId: string;
	orgLimit: number;
	totalBytes: number;
	totalCount: number;
	members: OrgMemberUsage[];
	memberCount: number;
}

export const storageAdminApi = {
	listOverrides: async (): Promise<StorageOverride[]> => {
		const r = await api.get<{ overrides: StorageOverride[] }>("/admin/overrides");
		return r.data?.overrides ?? [];
	},
	upsertOverride: async (input: {
		subjectType: QuotaSubjectType;
		subjectId: string;
		limitBytes: number;
	}): Promise<{ data: StorageOverride | null; status?: number }> => {
		const r = await api.put<StorageOverride>("/admin/overrides", { body: input, idempotencyData: input });
		return { data: r.data ?? null, status: r.status };
	},
	deleteOverride: async (id: string): Promise<boolean> => {
		const r = await api.delete<{ ok: boolean }>(`/admin/overrides/${id}`, { idempotencyKey: id });
		return !!r.data?.ok;
	},
	userUsage: async (userId: string): Promise<StorageUsageSnapshot | null> => {
		const r = await api.get<StorageUsageSnapshot>(`/admin/users/${encodeURIComponent(userId)}/usage`);
		return r.data ?? null;
	},
	orgLimits: async (orgId: string): Promise<OrgLimitsInfo | null> => {
		const r = await api.get<OrgLimitsInfo>(`/admin/orgs/${encodeURIComponent(orgId)}/limits`);
		return r.data ?? null;
	},
	orgUsage: async (orgId: string): Promise<OrgUsageInfo | null> => {
		const r = await api.get<OrgUsageInfo>(`/admin/orgs/${encodeURIComponent(orgId)}/usage`);
		return r.data ?? null;
	},
	apps: async (): Promise<StorageAppInfo[]> => {
		const r = await api.get<{ apps: StorageAppInfo[] }>("/apps");
		return r.data?.apps ?? [];
	},
	reconcile: async (): Promise<{ apps: string[]; usersUpdated: number } | null> => {
		const r = await api.post<{ apps: string[]; usersUpdated: number }>("/admin/reconcile", { idempotencyData: { action: "reconcile" } });
		return r.data ?? null;
	},
};

export function formatBytes(bytes: number): string {
	if (bytes < 0) return "∞";
	if (bytes === 0) return "0 B";
	const units = ["B", "KB", "MB", "GB", "TB"];
	const i = Math.min(Math.floor(Math.log2(bytes) / 10), units.length - 1);
	const value = bytes / 1024 ** i;
	return `${value >= 100 || i === 0 ? Math.round(value) : value.toFixed(1)} ${units[i]}`;
}
