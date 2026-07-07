import { useState, useEffect, useCallback } from "react";
import { useTranslation } from "@ui-library/utils/i18n-react";
import type { Permission } from "@common/types/identity/index.d.ts";
import { Scope, canUpdate } from "../utils/permissions.ts";
import { DataTable, type Column } from "../components/DataTable.tsx";
import { FormModalFooter } from "../components/FormModalFooter.tsx";
import { clearErrors } from "@ui-library/utils/adc-fetch";
import { moderationApi, type BanItem } from "../utils/moderation-api.ts";
import { UnbanModal, type UnbanTarget } from "../components/UnbanModal.tsx";

interface ModerationViewProps {
	readonly perms: Permission[];
}

/**
 * Tab "Moderación": lista de bans anti-evasión (ModerationService) con alta de
 * bans raw (emails/IPs) y levantamiento. Los bans de usuarios de plataforma se
 * crean desde la tabla de Usuarios; acá se ven TODOS (incl. externos/raw).
 * Gate del backend: identity.users (READ lista, UPDATE banear/desbanear), admin global.
 */
export function ModerationView({ perms }: ModerationViewProps) {
	const { t } = useTranslation({ namespace: "adc-identity", autoLoad: true });
	const [bans, setBans] = useState<BanItem[]>([]);
	const [filtered, setFiltered] = useState<BanItem[]>([]);
	const [includeLifted, setIncludeLifted] = useState(false);
	const [loading, setLoading] = useState(true);
	const [modalOpen, setModalOpen] = useState(false);
	const [detailBan, setDetailBan] = useState<BanItem | null>(null);
	const [unbanBan, setUnbanBan] = useState<BanItem | null>(null);

	// Form: ban raw por emails/IPs
	const [formEmails, setFormEmails] = useState("");
	const [formIps, setFormIps] = useState("");
	const [formReason, setFormReason] = useState("");
	const [formExpiresAt, setFormExpiresAt] = useState("");
	const [submitting, setSubmitting] = useState(false);
	const [formError, setFormError] = useState<string | null>(null);

	const updatable = canUpdate(perms, Scope.USERS);

	const modalRef = useCallback((el: HTMLElement | null) => {
		if (el) el.addEventListener("adcClose", () => setModalOpen(false));
	}, []);

	const detailModalRef = useCallback((el: HTMLElement | null) => {
		if (el) el.addEventListener("adcClose", () => setDetailBan(null));
	}, []);

	const loadData = useCallback(async () => {
		setLoading(true);
		const list = await moderationApi.listBans(!includeLifted);
		setBans(list);
		setFiltered(list);
		setLoading(false);
	}, [includeLifted]);

	useEffect(() => {
		void loadData();
	}, [loadData]);

	const handleSearch = (query: string) => {
		if (!query) {
			setFiltered(bans);
			return;
		}
		const q = query.toLowerCase();
		setFiltered(
			bans.filter(
				(b) =>
					(b.userId ?? "").toLowerCase().includes(q) ||
					b.reason.toLowerCase().includes(q) ||
					b.source.toLowerCase().includes(q) ||
					(b.externalId ?? "").toLowerCase().includes(q) ||
					b.emailMasks.some((m) => m.toLowerCase().includes(q))
			)
		);
	};

	const openCreate = () => {
		setFormEmails("");
		setFormIps("");
		setFormReason("");
		setFormExpiresAt("");
		setFormError(null);
		setModalOpen(true);
	};

	const splitList = (value: string): string[] =>
		value
			.split(/[\n,;]+/)
			.map((s) => s.trim())
			.filter(Boolean);

	const handleSubmit = async (e: React.SubmitEvent) => {
		e.preventDefault();
		clearErrors();
		setFormError(null);
		const emails = splitList(formEmails);
		const ips = splitList(formIps);
		if (!formReason.trim()) {
			setFormError(t("moderation.reasonRequired"));
			return;
		}
		if (emails.length === 0 && ips.length === 0) {
			setFormError(t("moderation.targetRequired"));
			return;
		}
		setSubmitting(true);
		const result = await moderationApi.banRaw({
			emails,
			ips,
			reason: formReason.trim(),
			expiresAt: formExpiresAt ? new Date(formExpiresAt).toISOString() : null,
		});
		setSubmitting(false);
		if (result.success) {
			setModalOpen(false);
			void loadData();
		}
	};

	/** Objetivo del unban de un registro: usuario de plataforma o referencia externa. */
	const unbanTargetOf = (b: BanItem): UnbanTarget | null => {
		if (b.userId) return { userId: b.userId };
		if (b.externalId) return { source: b.source, externalId: b.externalId };
		return null;
	};

	const banTargetLabel = (b: BanItem): string => {
		if (b.userId) return b.userId;
		if (b.emailMasks.length) return b.emailMasks.join(", ");
		return b.externalId ? `${b.source}:${b.externalId}` : b.source;
	};

	const columns: Column<BanItem>[] = [
		{
			key: "userId",
			label: t("moderation.target"),
			render: (b) => <span className="text-xs font-mono">{banTargetLabel(b)}</span>,
		},
		{ key: "reason", label: t("moderation.reason") },
		{
			key: "active",
			label: t("moderation.status"),
			render: (b) => (
				<adc-badge color={b.active ? "red" : "gray"} size="sm">
					{b.active ? t("moderation.active") : t("moderation.lifted")}
				</adc-badge>
			),
		},
		{
			key: "bannedAt",
			label: t("moderation.bannedAt"),
			render: (b) => <span className="text-muted text-xs">{new Date(b.bannedAt).toLocaleString()}</span>,
		},
		{
			key: "expiresAt",
			label: t("moderation.expiresAt"),
			render: (b) => (
				<span className="text-muted text-xs">{b.expiresAt ? new Date(b.expiresAt).toLocaleString() : t("moderation.permanent")}</span>
			),
		},
		{
			key: "emailHashCount",
			label: t("moderation.coverage"),
			render: (b) => (
				<button
					type="button"
					className="text-muted text-xs underline decoration-dotted underline-offset-2 cursor-pointer hover:text-text"
					title={t("moderation.viewDetails")}
					onClick={() => setDetailBan(b)}
				>
					{b.emailHashCount} emails · {b.ipHashCount} IPs
				</button>
			),
		},
	];

	return (
		<>
			<div className="mb-3 flex items-center gap-2">
				<adc-checkbox
					checked={includeLifted}
					label={t("moderation.includeLifted")}
					onClick={() => setIncludeLifted((prev) => !prev)}
				/>
			</div>

			<DataTable
				columns={columns}
				data={filtered}
				loading={loading}
				searchPlaceholder={t("moderation.searchPlaceholder")}
				onSearch={handleSearch}
				onAdd={updatable ? openCreate : undefined}
				addLabel={t("moderation.addBan")}
				keyExtractor={(b) => b.id}
				emptyMessage={t("moderation.noBans")}
				actions={(ban) =>
					updatable && ban.active && (ban.userId || ban.externalId) ? (
						<adc-button size="small" variant="danger-outlined" onClick={() => setUnbanBan(ban)}>
							{t("moderation.unban")}
						</adc-button>
					) : null
				}
			/>

			{modalOpen && (
				<adc-modal ref={modalRef} open modalTitle={t("moderation.addBan")} size="md">
					<form onSubmit={handleSubmit} className="space-y-4">
						<p className="text-xs text-muted">{t("moderation.rawBanHint")}</p>
						<div>
							<label className="block text-sm font-medium mb-1 text-text">{t("moderation.emails")}</label>
							<adc-input value={formEmails} placeholder="a@x.com, b@y.com" onInput={(e: any) => setFormEmails(e.target.value)} />
						</div>
						<div>
							<label className="block text-sm font-medium mb-1 text-text">{t("moderation.ips")}</label>
							<adc-input value={formIps} placeholder="1.2.3.4, 5.6.7.8" onInput={(e: any) => setFormIps(e.target.value)} />
						</div>
						<div>
							<label className="block text-sm font-medium mb-1 text-text">{t("moderation.reason")}</label>
							<adc-input value={formReason} placeholder={t("moderation.reasonPlaceholder")} onInput={(e: any) => setFormReason(e.target.value)} />
						</div>
						<div>
							<label className="block text-sm font-medium mb-1 text-text">{t("moderation.expiresAt")}</label>
							<adc-input type="datetime-local" value={formExpiresAt} onInput={(e: any) => setFormExpiresAt(e.target.value)} />
							<p className="text-xs text-muted mt-1">{t("moderation.permanentHint")}</p>
						</div>
						{formError && <p className="text-sm text-red-500">{formError}</p>}
						<FormModalFooter onCancel={() => setModalOpen(false)} submitting={submitting} />
					</form>
				</adc-modal>
			)}

			{/* Detalle de cobertura: máscaras de email + prefijos de hash (correlación visual) */}
			{detailBan && (
				<adc-modal ref={detailModalRef} open modalTitle={t("moderation.detailsTitle")} size="md">
					<div className="space-y-4 text-sm">
						<div>
							<p className="font-medium text-text mb-1">{t("moderation.target")}</p>
							<p className="text-xs font-mono text-muted">{banTargetLabel(detailBan)}</p>
						</div>
						<div>
							<p className="font-medium text-text mb-1">
								{t("moderation.maskedEmails")} ({detailBan.emailHashCount})
							</p>
							{detailBan.emailMasks.length > 0 ? (
								<ul className="text-xs font-mono text-muted space-y-0.5">
									{detailBan.emailMasks.map((m) => (
										<li key={m}>{m}</li>
									))}
								</ul>
							) : (
								<p className="text-xs text-muted">
									{detailBan.emailHashCount > 0 ? t("moderation.noMasksLegacy") : "—"}
								</p>
							)}
						</div>
						<div>
							<p className="font-medium text-text mb-1">{t("moderation.emailHashes")}</p>
							{detailBan.emailHashPrefixes.length > 0 ? (
								<div className="flex flex-wrap gap-1">
									{detailBan.emailHashPrefixes.map((h) => (
										<adc-badge key={h} color="gray" size="sm">
											<span className="font-mono">{h}…</span>
										</adc-badge>
									))}
								</div>
							) : (
								<p className="text-xs text-muted">—</p>
							)}
						</div>
						<div>
							<p className="font-medium text-text mb-1">{t("moderation.ipHashes")}</p>
							{detailBan.ipHashPrefixes.length > 0 ? (
								<div className="flex flex-wrap gap-1">
									{detailBan.ipHashPrefixes.map((h) => (
										<adc-badge key={h} color="gray" size="sm">
											<span className="font-mono">{h}…</span>
										</adc-badge>
									))}
								</div>
							) : (
								<p className="text-xs text-muted">—</p>
							)}
						</div>
						<p className="text-xs text-muted">{t("moderation.hashPrefixHint")}</p>
						{!detailBan.active && detailBan.unbanReason && (
							<div>
								<p className="font-medium text-text mb-1">{t("moderation.unbanReason")}</p>
								<p className="text-xs text-muted">{detailBan.unbanReason}</p>
							</div>
						)}
					</div>
				</adc-modal>
			)}

			{unbanBan &&
				(() => {
					const target = unbanTargetOf(unbanBan);
					return target ? (
						<UnbanModal
							target={target}
							targetLabel={banTargetLabel(unbanBan)}
							onClose={() => setUnbanBan(null)}
							onUnbanned={() => {
								setUnbanBan(null);
								void loadData();
							}}
						/>
					) : null;
				})()}
		</>
	);
}
