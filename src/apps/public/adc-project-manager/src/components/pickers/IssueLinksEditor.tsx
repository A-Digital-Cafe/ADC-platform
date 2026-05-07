import { useMemo, useState } from "react";
import { useTranslation } from "@ui-library/utils/i18n-react";
import type { Issue } from "@common/types/project-manager/Issue.ts";
import type { IssueLink, IssueLinkType } from "@common/types/project-manager/IssueLink.ts";

interface Props {
	linkTypes: IssueLinkType[];
	currentIssueId?: string;
	allIssues: Issue[];
	value: IssueLink[];
	onChange: (links: IssueLink[]) => void;
	disabled?: boolean;
}

/**
 * Editor de vínculos entre issues. Usa los tipos definidos en
 * `project.issueLinkTypes` y permite agregar/remover IssueLink.
 */
export function IssueLinksEditor({ linkTypes, currentIssueId, allIssues, value, onChange, disabled }: Readonly<Props>) {
	const { t } = useTranslation({ namespace: "adc-project-manager" });
	const [linkTypeId, setLinkTypeId] = useState<string>(linkTypes[0]?.id ?? "");
	const [targetIssueId, setTargetIssueId] = useState<string>("");

	const issuesById = useMemo(() => new Map(allIssues.map((i) => [i.id, i])), [allIssues]);
	const typesById = useMemo(() => new Map(linkTypes.map((lt) => [lt.id, lt])), [linkTypes]);

	const availableTargets = useMemo(
		() => allIssues.filter((i) => i.id !== currentIssueId && !value.some((l) => l.targetIssueId === i.id)),
		[allIssues, currentIssueId, value]
	);

	if (linkTypes.length === 0) {
		return <p className="text-xs text-muted">{t("issues.noLinkTypes")}</p>;
	}

	const add = () => {
		if (!linkTypeId || !targetIssueId) return;
		onChange([...value, { linkTypeId, targetIssueId }]);
		setTargetIssueId("");
	};

	const remove = (link: IssueLink) =>
		onChange(value.filter((l) => !(l.linkTypeId === link.linkTypeId && l.targetIssueId === link.targetIssueId)));

	return (
		<div className="space-y-2">
			{value.length > 0 && (
				<ul className="space-y-1">
					{value.map((link) => {
						const type = typesById.get(link.linkTypeId);
						const target = issuesById.get(link.targetIssueId);
						return (
							<li
								key={`${link.linkTypeId}:${link.targetIssueId}`}
								className="flex items-center gap-2 p-1.5 border border-border rounded-md bg-surface text-sm"
							>
								{type && (
									<adc-color-label color={type.color} size="xs">
										{type.name}
									</adc-color-label>
								)}
								<span className="font-mono text-xs text-muted">{target?.key ?? link.targetIssueId}</span>
								<span className="flex-1 truncate">{target?.title ?? "—"}</span>
								{!disabled && (
									<button
										type="button"
										onClick={() => remove(link)}
										className="text-tdanger font-bold text-sm"
										aria-label={t("common.delete")}
									>
										×
									</button>
								)}
							</li>
						);
					})}
				</ul>
			)}
			{!disabled && (
				<div className="flex items-center gap-2">
					<adc-combobox
						value={linkTypeId}
						clearable={false}
						options={JSON.stringify(linkTypes.map((lt) => ({ label: lt.name, value: lt.id })))}
						onadcChange={(e: any) => setLinkTypeId(e.detail)}
					/>
					<adc-combobox
						value={targetIssueId}
						placeholder={t("issues.selectIssue")}
						options={JSON.stringify(availableTargets.map((i) => ({ label: `${i.key} · ${i.title}`, value: i.id })))}
						onadcChange={(e: any) => setTargetIssueId(e.detail ?? "")}
					/>
					<adc-button variant="accent" onClick={add} disabled={!linkTypeId || !targetIssueId}>
						{t("common.add")}
					</adc-button>
				</div>
			)}
		</div>
	);
}
