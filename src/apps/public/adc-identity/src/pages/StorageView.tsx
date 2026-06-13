import { useState, useEffect, useCallback } from "react";
import { useTranslation } from "@ui-library/utils/i18n-react";
import type { Permission } from "@common/types/identity/index.d.ts";
import type { QuotaSubjectType, StorageUsageSnapshot } from "@common/types/storage/quota.ts";
import { UNLIMITED_BYTES } from "@common/types/storage/quota.ts";
import { StorageScopes, STORAGE_RESOURCE_NAME } from "@common/types/storage/permissions.ts";
import { CRUDXAction } from "@common/types/Actions";
import { hasPermission } from "@common/utils/perms.ts";
import { DataTable, type Column } from "../components/DataTable.tsx";
import { DeleteConfirmModal } from "../components/DeleteConfirmModal.tsx";
import { FormModalFooter } from "../components/FormModalFooter.tsx";
import { storageAdminApi, formatBytes, type StorageOverride, type OrgLimitsInfo, type OrgUsageInfo } from "../utils/storage-api.ts";

const MB = 1024 * 1024;

interface StorageViewProps {
	readonly perms: Permission[];
	/** orgId del token: si está, el caller es org admin (subjects limitados). */
	readonly orgId?: string;
}

export function StorageView({ perms, orgId }: StorageViewProps) {
	const { t } = useTranslation({ namespace: "adc-identity", autoLoad: true });
	const [overrides, setOverrides] = useState<StorageOverride[]>([]);
	const [loading, setLoading] = useState(true);
	const [modalOpen, setModalOpen] = useState(false);
	const [deleteConfirm, setDeleteConfirm] = useState<StorageOverride | null>(null);

	// Form state
	const [formSubjectType, setFormSubjectType] = useState<QuotaSubjectType>("user");
	const [formSubjectId, setFormSubjectId] = useState("");
	const [formLimitMb, setFormLimitMb] = useState("");
	const [formUnlimited, setFormUnlimited] = useState(false);
	const [formError, setFormError] = useState<string | null>(null);
	const [submitting, setSubmitting] = useState(false);

	// Lookup de uso por usuario
	const [usageUserId, setUsageUserId] = useState("");
	const [usage, setUsage] = useState<StorageUsageSnapshot | null>(null);

	// Uso agregado de la org (overview) + default por miembro
	const [orgUsage, setOrgUsage] = useState<OrgUsageInfo | null>(null);
	const [orgLimits, setOrgLimits] = useState<OrgLimitsInfo | null>(null);
	const [memberDefaultMb, setMemberDefaultMb] = useState("");
	const [memberDefaultError, setMemberDefaultError] = useState<string | null>(null);
	const [savingDefault, setSavingDefault] = useState(false);

	// Reconcile
	const [reconciling, setReconciling] = useState(false);
	const [reconcileResult, setReconcileResult] = useState<string | null>(null);

	const updatable = hasPermission(perms, STORAGE_RESOURCE_NAME, CRUDXAction.UPDATE, StorageScopes.LIMITS);
	const canReadUsage = hasPermission(perms, STORAGE_RESOURCE_NAME, CRUDXAction.READ, StorageScopes.USAGE);
	const isGlobal = !orgId;

	const editModalRef = useCallback((el: HTMLElement | null) => {
		if (el) el.addEventListener("adcClose", () => setModalOpen(false));
	}, []);

	const loadData = useCallback(async () => {
		setLoading(true);
		const [list, limits, usageAgg] = await Promise.all([
			storageAdminApi.listOverrides(),
			orgId ? storageAdminApi.orgLimits(orgId) : Promise.resolve(null),
			orgId && canReadUsage ? storageAdminApi.orgUsage(orgId) : Promise.resolve(null),
		]);
		setOverrides(list);
		setOrgLimits(limits);
		setOrgUsage(usageAgg);
		setLoading(false);
	}, [orgId, canReadUsage]);

	useEffect(() => {
		void loadData();
	}, [loadData]);

	const openCreate = () => {
		setFormSubjectType("user");
		setFormSubjectId("");
		setFormLimitMb("");
		setFormUnlimited(false);
		setFormError(null);
		setModalOpen(true);
	};

	const submit = async () => {
		const subjectId = formSubjectId.trim();
		const limitMb = Number(formLimitMb);
		if (!subjectId || (!formUnlimited && (!Number.isFinite(limitMb) || limitMb < 0))) {
			setFormError(t("storage.formInvalid"));
			return;
		}
		setSubmitting(true);
		setFormError(null);
		const result = await storageAdminApi.upsertOverride({
			subjectType: formSubjectType,
			subjectId,
			limitBytes: formUnlimited ? UNLIMITED_BYTES : Math.round(limitMb * MB),
		});
		setSubmitting(false);
		if (!result.data) {
			setFormError(result.status === 403 ? t("storage.limitRejected") : t("storage.formInvalid"));
			return;
		}
		setModalOpen(false);
		await loadData();
	};

	const lookupUsage = async () => {
		const id = usageUserId.trim();
		if (!id) return;
		setUsage(await storageAdminApi.userUsage(id));
	};

	const saveMemberDefault = async () => {
		if (!orgId) return;
		const mb = Number(memberDefaultMb);
		if (!Number.isFinite(mb) || mb < 0) {
			setMemberDefaultError(t("storage.formInvalid"));
			return;
		}
		setSavingDefault(true);
		setMemberDefaultError(null);
		const result = await storageAdminApi.upsertOverride({
			subjectType: "org-members-default",
			subjectId: orgId,
			limitBytes: Math.round(mb * MB),
		});
		setSavingDefault(false);
		if (!result.data) {
			setMemberDefaultError(result.status === 403 ? t("storage.limitRejected") : t("storage.formInvalid"));
			return;
		}
		setMemberDefaultMb("");
		await loadData();
	};

	const resetMemberDefault = async () => {
		if (!orgId) return;
		const override = overrides.find((o) => o.subjectType === "org-members-default" && o.subjectId === orgId);
		if (!override) return;
		setSavingDefault(true);
		await storageAdminApi.deleteOverride(override.id);
		setSavingDefault(false);
		await loadData();
	};

	const reconcile = async () => {
		setReconciling(true);
		setReconcileResult(null);
		const result = await storageAdminApi.reconcile();
		setReconciling(false);
		setReconcileResult(
			result ? t("storage.reconcileDone", { apps: result.apps.join(", ") || "-", users: String(result.usersUpdated) }) : t("storage.reconcileFailed")
		);
	};

	const columns: Column<StorageOverride>[] = [
		{ key: "subjectType", label: t("storage.subjectType"), render: (o) => t(`storage.subject.${o.subjectType}`) },
		{ key: "subjectId", label: t("storage.subjectId"), render: (o) => <code className="text-xs">{o.subjectId}</code> },
		{ key: "orgId", label: t("common.organization"), render: (o) => (o.orgId ? <code className="text-xs">{o.orgId}</code> : t("storage.globalScope")) },
		{ key: "limitBytes", label: t("storage.limit"), render: (o) => formatBytes(o.limitBytes) },
		{ key: "updatedAt", label: t("storage.updatedAt"), render: (o) => new Date(o.updatedAt).toLocaleString() },
	];

	return (
		<div>
			<DataTable
				columns={columns}
				data={overrides}
				loading={loading}
				onAdd={updatable ? openCreate : undefined}
				addLabel={t("storage.addOverride")}
				keyExtractor={(o) => o.id}
				emptyMessage={t("storage.noOverrides")}
				actions={
					updatable
						? (o) => (
								<button type="button" className="text-xs text-danger hover:underline" onClick={() => setDeleteConfirm(o)}>
									{t("common.delete")}
								</button>
							)
						: undefined
				}
			/>

			{/* Uso agregado de la org (overview) — visible al seleccionar una org (global admin) o en contexto org */}
			{orgId && orgUsage && (
				<section className="mt-8 max-w-xl">
					<h3 className="text-sm font-medium text-text mb-1">{t("storage.orgUsageTitle")}</h3>
					<p className="text-sm text-text mb-3">
						{t("storage.orgUsageSummary", {
							used: formatBytes(orgUsage.totalBytes),
							limit: formatBytes(orgUsage.orgLimit),
							members: String(orgUsage.memberCount),
						})}
					</p>
					{orgUsage.members.length > 0 && (
						<>
							<h4 className="text-xs font-medium text-muted mb-2">{t("storage.orgUsageTopMembers")}</h4>
							<ul className="divide-y divide-muted/20 rounded border border-muted/20 text-sm">
								{orgUsage.members.slice(0, 10).map((member) => (
									<li key={member.userId} className="flex items-center justify-between px-3 py-2">
										<span className="text-text">{member.username ?? member.userId}</span>
										<span className="text-muted">
											{formatBytes(member.totalBytes)} · {member.totalCount}
										</span>
									</li>
								))}
							</ul>
						</>
					)}
				</section>
			)}

			{/* Default por miembro de la organización */}
			{orgId && orgLimits && (
				<section className="mt-8 max-w-xl">
					<h3 className="text-sm font-medium text-text mb-2">{t("storage.memberDefaultTitle")}</h3>
					<p className="text-xs text-muted mb-2">{t("storage.memberDefaultHint", { value: formatBytes(orgLimits.memberDefault.tierBytes) })}</p>
					<p className="text-sm text-text mb-3">
						{t("storage.memberDefaultEffective", {
							value: formatBytes(orgLimits.memberDefault.effectiveBytes),
							orgLimit: formatBytes(orgLimits.orgLimit),
						})}
						{orgLimits.memberDefault.overrideBytes !== null && <span className="text-muted"> · {t("storage.memberDefaultOverridden")}</span>}
					</p>
					{updatable && (
						<div className="flex flex-wrap items-center gap-2">
							<input
								type="number"
								min="0"
								className="rounded border border-muted/30 bg-background px-3 py-2 text-sm text-text w-40"
								placeholder={t("storage.limitMb")}
								value={memberDefaultMb}
								onChange={(e) => setMemberDefaultMb(e.target.value)}
							/>
							<adc-button
								variant="accent"
								label={savingDefault ? t("common.loading") : t("common.save")}
								disabled={savingDefault}
								onClick={() => void saveMemberDefault()}
							/>
							{orgLimits.memberDefault.overrideBytes !== null && (
								<button type="button" className="text-xs text-muted hover:underline" onClick={() => void resetMemberDefault()}>
									{t("storage.memberDefaultReset")}
								</button>
							)}
						</div>
					)}
					{memberDefaultError && <p className="text-danger text-xs mt-2">{memberDefaultError}</p>}
				</section>
			)}

			{/* Lookup de uso por usuario */}
			<section className="mt-8">
				<h3 className="text-sm font-medium text-text mb-2">{t("storage.usageLookup")}</h3>
				<div className="flex flex-wrap gap-2 items-center">
					<input
						type="text"
						className="rounded border border-muted/30 bg-background px-3 py-2 text-sm text-text min-w-72"
						placeholder={t("storage.userIdPlaceholder")}
						value={usageUserId}
						onChange={(e) => setUsageUserId(e.target.value)}
						onKeyDown={(e) => {
							if (e.key === "Enter") void lookupUsage();
						}}
					/>
					<adc-button variant="accent" label={t("common.search")} onClick={() => void lookupUsage()} />
				</div>
				{usage && (
					<div className="mt-3 rounded border border-muted/20 p-4 text-sm max-w-xl">
						<p className="text-text font-medium mb-2">
							{formatBytes(usage.totalBytes)} / {formatBytes(usage.effectiveLimit)} · {usage.totalCount} {t("storage.files")}
						</p>
						<ul className="text-muted text-xs space-y-1">
							{Object.entries(usage.apps).map(([appId, appUsage]) => (
								<li key={appId}>
									{appId}: {formatBytes(appUsage.bytes)} ({appUsage.count})
								</li>
							))}
						</ul>
					</div>
				)}
			</section>

			{/* Reconciliación (solo contexto global) */}
			{isGlobal && updatable && (
				<section className="mt-8">
					<h3 className="text-sm font-medium text-text mb-2">{t("storage.reconcileTitle")}</h3>
					<p className="text-xs text-muted mb-2">{t("storage.reconcileHint")}</p>
					<adc-button
						variant="accent"
						label={reconciling ? t("common.loading") : t("storage.reconcile")}
						disabled={reconciling}
						onClick={() => void reconcile()}
					/>
					{reconcileResult && <p className="text-xs text-muted mt-2">{reconcileResult}</p>}
				</section>
			)}

			{/* Modal crear/editar override */}
			{modalOpen && (
				<adc-modal ref={editModalRef} open modalTitle={t("storage.addOverride")} size="md">
					<form
						className="flex flex-col gap-3 p-2"
						onSubmit={(e) => {
							e.preventDefault();
							void submit();
						}}
					>
						<label htmlFor="storage-subject-type" className="text-xs text-muted">
							{t("storage.subjectType")}
						</label>
						<select
							id="storage-subject-type"
							className="rounded border border-muted/30 bg-background px-3 py-2 text-sm text-text"
							value={formSubjectType}
							onChange={(e) => setFormSubjectType(e.target.value as QuotaSubjectType)}
						>
							<option value="user">{t("storage.subject.user")}</option>
							<option value="role">{t("storage.subject.role")}</option>
							{isGlobal && <option value="org">{t("storage.subject.org")}</option>}
						</select>
						<label htmlFor="storage-subject-id" className="text-xs text-muted">
							{t("storage.subjectId")}
						</label>
						<input
							id="storage-subject-id"
							type="text"
							className="rounded border border-muted/30 bg-background px-3 py-2 text-sm text-text"
							placeholder={t("storage.subjectIdPlaceholder")}
							value={formSubjectId}
							onChange={(e) => setFormSubjectId(e.target.value)}
						/>
						{isGlobal && (
							<label className="flex items-center gap-2 text-sm text-text">
								<input type="checkbox" checked={formUnlimited} onChange={(e) => setFormUnlimited(e.target.checked)} />
								{t("storage.unlimited")}
							</label>
						)}
						{!formUnlimited && (
							<>
								<label htmlFor="storage-limit-mb" className="text-xs text-muted">
									{t("storage.limitMb")}
								</label>
								<input
									id="storage-limit-mb"
									type="number"
									min="0"
									className="rounded border border-muted/30 bg-background px-3 py-2 text-sm text-text"
									value={formLimitMb}
									onChange={(e) => setFormLimitMb(e.target.value)}
								/>
							</>
						)}
						{formError && <p className="text-danger text-xs">{formError}</p>}
						<FormModalFooter submitting={submitting} onCancel={() => setModalOpen(false)} />
					</form>
				</adc-modal>
			)}

			{deleteConfirm && (
				<DeleteConfirmModal
					message={t("storage.subject." + deleteConfirm.subjectType) + ": " + deleteConfirm.subjectId}
					onConfirm={() => {
						void storageAdminApi.deleteOverride(deleteConfirm.id).then(() => {
							setDeleteConfirm(null);
							void loadData();
						});
					}}
					onClose={() => setDeleteConfirm(null)}
				/>
			)}
		</div>
	);
}
