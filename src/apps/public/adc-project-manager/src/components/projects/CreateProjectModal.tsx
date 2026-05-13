import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "@ui-library/utils/i18n-react";
import type { ProjectVisibility } from "@common/types/project-manager/Project.ts";
import { pmApi } from "../../utils/pm-api.ts";

const SLUG_DEBOUNCE_MS = 400;

type SlugStatus = "idle" | "checking" | "available" | "taken" | "invalid";

export interface AllowedVisibilities {
	private: boolean;
	org: boolean;
	public: boolean;
}

export interface OrganizationOption {
	orgId: string;
	slug: string;
}

interface ProjectFormState {
	name: string;
	slug: string;
	description: string;
	visibility: ProjectVisibility;
	orgId: string | null;
}

interface Props {
	/** Slug de la org del propio caller (o "default" si es contexto global). Se usa para el chequeo de slug cuando el admin global no eligió todavía una org. */
	orgSlug: string;
	/** Visibilidades habilitadas para el caller. */
	allowed: AllowedVisibilities;
	/** Lista de orgs disponibles cuando el caller puede elegir (admin global). */
	organizations?: OrganizationOption[];
	/** orgId preseleccionado (token del caller en modo org). */
	defaultOrgId?: string | null;
	onClose: () => void;
	onSubmit: (form: ProjectFormState) => Promise<void> | void;
}

export function CreateProjectModal({ orgSlug, allowed, organizations, defaultOrgId, onClose, onSubmit }: Readonly<Props>) {
	const { t } = useTranslation({ namespace: "adc-project-manager" });

	const defaultVisibility: ProjectVisibility = useMemo(() => {
		if (allowed.org) return "org";
		if (allowed.private) return "private";
		if (allowed.public) return "public";
		return "private";
	}, [allowed]);

	const [form, setForm] = useState<ProjectFormState>({
		name: "",
		slug: "",
		description: "",
		visibility: defaultVisibility,
		orgId: defaultOrgId ?? null,
	});
	const [slugStatus, setSlugStatus] = useState<SlugStatus>("idle");
	const slugCheckTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

	const visibilityOptions = useMemo(
		() =>
			(["private", "org", "public"] as ProjectVisibility[])
				.filter((v) => allowed[v])
				.map((v) => ({ label: t(`projects.${v}`), value: v })),
		[allowed, t]
	);

	const needsOrgPicker = form.visibility === "org" && !!organizations?.length;
	const currentOrgSlug = useMemo(() => {
		if (form.visibility !== "org") return "default";
		if (form.orgId && organizations?.length) {
			return organizations.find((o) => o.orgId === form.orgId)?.slug ?? orgSlug;
		}
		return orgSlug;
	}, [form.visibility, form.orgId, organizations, orgSlug]);

	const modalRef = useCallback(
		(el: HTMLElement | null) => {
			if (el) el.addEventListener("adcClose", onClose);
		},
		[onClose]
	);

	const runSlugCheck = useCallback((slugValue: string, forOrgSlug: string) => {
		if (slugCheckTimer.current) clearTimeout(slugCheckTimer.current);
		if (!slugValue) {
			setSlugStatus("idle");
			return;
		}
		if (!/^[a-z0-9-]+$/.test(slugValue)) {
			setSlugStatus("invalid");
			return;
		}
		setSlugStatus("checking");
		slugCheckTimer.current = setTimeout(async () => {
			const res = await pmApi.checkProjectSlug(forOrgSlug, slugValue);
			if (res.success && res.data) setSlugStatus(res.data.available ? "available" : "taken");
			else setSlugStatus("idle");
		}, SLUG_DEBOUNCE_MS);
	}, []);

	const handleSlugInput = useCallback(
		(value: string) => {
			const normalized = value.toLowerCase().trim();
			setForm((f) => ({ ...f, slug: normalized }));
			runSlugCheck(normalized, currentOrgSlug);
		},
		[runSlugCheck, currentOrgSlug]
	);

	// Re-validar slug cuando cambia el scope (visibility u org elegida).
	useEffect(() => {
		if (form.slug) runSlugCheck(form.slug, currentOrgSlug);
	}, [currentOrgSlug]);

	useEffect(() => {
		return () => {
			if (slugCheckTimer.current) clearTimeout(slugCheckTimer.current);
		};
	}, []);

	const handleSave = async () => {
		if (!form.name || slugStatus !== "available") return;
		if (form.visibility === "org" && !form.orgId) return;
		await onSubmit(form);
	};

	const canSave = !!form.name && slugStatus === "available" && (form.visibility !== "org" || !!form.orgId);

	return (
		<adc-modal ref={modalRef} open modalTitle={t("projects.newProject")} size="md">
			<div className="space-y-3 p-4 min-w-80">
				<div>
					<label className="block text-sm font-medium mb-1 text-text">{t("projects.slug")}</label>
					<div className="flex items-center gap-2">
						<adc-input value={form.slug} onInput={(e: any) => handleSlugInput(e.target.value)} class="flex-1" />
						<span aria-live="polite">
							{slugStatus === "checking" && <span className="text-muted animate-pulse px-2">…</span>}
							{slugStatus === "available" && (
								<span className="text-tsuccess px-2" title={t("projects.slugAvailable")}>
									✓
								</span>
							)}
							{(slugStatus === "taken" || slugStatus === "invalid") && (
								<span className="text-tdanger px-2" title={t(`projects.slug${slugStatus === "taken" ? "Taken" : "Invalid"}`)}>
									✗
								</span>
							)}
						</span>
					</div>
					{slugStatus === "taken" && <p className="text-xs text-tdanger mt-1">{t("projects.slugTaken")}</p>}
					{slugStatus === "invalid" && <p className="text-xs text-tdanger mt-1">{t("projects.slugInvalid")}</p>}
				</div>
				<div>
					<label className="block text-sm font-medium mb-1 text-text">{t("common.name")}</label>
					<adc-input value={form.name} onInput={(e: any) => setForm({ ...form, name: e.target.value })} />
				</div>
				<div>
					<label className="block text-sm font-medium mb-1 text-text">{t("common.description")}</label>
					<adc-input value={form.description} onInput={(e: any) => setForm({ ...form, description: e.target.value })} />
				</div>
				<div>
					<label className="block text-sm font-medium mb-1 text-text">{t("projects.visibility")}</label>
					<adc-combobox
						value={form.visibility}
						options={JSON.stringify(visibilityOptions)}
						onadcChange={(e: any) => setForm({ ...form, visibility: e.detail as ProjectVisibility })}
					/>
				</div>
				{needsOrgPicker && (
					<div>
						<label className="block text-sm font-medium mb-1 text-text">{t("projects.orgId")}</label>
						<adc-combobox
							value={form.orgId ?? ""}
							options={JSON.stringify(organizations.map((o) => ({ label: o.slug, value: o.orgId })))}
							onadcChange={(e: any) => setForm((f) => ({ ...f, orgId: (e.detail as string) || null }))}
						/>
					</div>
				)}
				<div className="flex gap-2 justify-end pt-2">
					<adc-button variant="accent" onClick={onClose}>
						{t("common.cancel")}
					</adc-button>
					<adc-button variant="primary" onClick={handleSave} disabled={!canSave}>
						{t("common.save")}
					</adc-button>
				</div>
			</div>
		</adc-modal>
	);
}

export type { ProjectFormState };
