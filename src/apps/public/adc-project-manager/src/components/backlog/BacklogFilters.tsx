import type { ReactNode } from "react";
import { useTranslation } from "@ui-library/utils/i18n-react";
import type { IssueListParams } from "../../utils/pm-api.ts";

export type GroupBy = "none" | "sprint" | "milestone";

interface Props {
	q: string;
	onQChange: (value: string) => void;
	orderBy: IssueListParams["orderBy"];
	onOrderByChange: (value: IssueListParams["orderBy"]) => void;
	groupBy: GroupBy;
	onGroupByChange: (value: GroupBy) => void;
	trailing?: ReactNode;
}

export function BacklogFilters({ q, onQChange, orderBy, onOrderByChange, groupBy, onGroupByChange, trailing }: Readonly<Props>) {
	const { t } = useTranslation({ namespace: "adc-project-manager" });
	return (
		<div className="flex gap-3 items-end flex-wrap">
			<div className="flex-1 min-w-60 max-w-100">
				<label className="block text-sm font-medium mb-1 text-text">{t("issues.filter")}</label>
				<adc-input placeholder={t("issues.searchPlaceholder")} value={q} onInput={(e: any) => onQChange(e.target.value)} />
			</div>
			<div>
				<label className="block text-sm font-medium mb-1 text-text">{t("issues.orderBy")}</label>
				<adc-combobox
					value={orderBy}
					clearable={false}
					options={JSON.stringify([
						{ label: t("issues.byPriority"), value: "priority" },
						{ label: t("issues.byCreatedAt"), value: "createdAt" },
						{ label: t("issues.byUpdatedAt"), value: "updatedAt" },
					])}
					onadcChange={(e: any) => onOrderByChange(e.detail)}
				/>
			</div>
			<div>
				<label className="block text-sm font-medium mb-1 text-text">{t("issues.groupBy")}</label>
				<adc-combobox
					value={groupBy}
					clearable={false}
					options={JSON.stringify([
						{ label: t("issues.groupNone"), value: "none" },
						{ label: t("issues.groupBySprint"), value: "sprint" },
						{ label: t("issues.groupByMilestone"), value: "milestone" },
					])}
					onadcChange={(e: any) => onGroupByChange(e.detail as GroupBy)}
				/>
			</div>
			{trailing && <div className="ml-auto">{trailing}</div>}
		</div>
	);
}
