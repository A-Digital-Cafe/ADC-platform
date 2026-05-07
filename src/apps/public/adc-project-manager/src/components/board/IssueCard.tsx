import type { Issue } from "@common/types/project-manager/Issue.ts";
import type { CustomFieldDef } from "@common/types/project-manager/CustomField.ts";
import { useTranslation } from "@ui-library/utils/i18n-react";

interface Props {
	issue: Issue;
	isDraggable: boolean;
	muted?: boolean;
	customFieldDefs?: CustomFieldDef[];
	onOpen: () => void;
}

interface ActiveBadge {
	key: string;
	name: string;
	color: string;
}

function collectActiveBadges(issue: Issue, defs: CustomFieldDef[]): ActiveBadge[] {
	const badges: ActiveBadge[] = [];
	for (const def of defs) {
		if (def.type !== "badge") continue;
		const value = issue.customFields?.[def.id];
		if (!Array.isArray(value) || value.length === 0) continue;
		const byName = new Map((def.badgeOptions ?? []).map((o) => [o.name, o.color]));
		for (const name of value) {
			const color = byName.get(name);
			if (!color) continue;
			badges.push({ key: `${def.id}:${name}`, name, color });
		}
	}
	return badges;
}

/**
 * Wrapper React sobre `adc-kanban-card` con los datos del issue resueltos
 * (prioridad, etc.). Mantiene la lógica de drag&drop nativa del browser
 * (dataTransfer).
 */
export function IssueCard({ issue, isDraggable, muted = false, customFieldDefs, onOpen }: Readonly<Props>) {
	const { t } = useTranslation({ namespace: "adc-project-manager" });
	const activeBadges = customFieldDefs ? collectActiveBadges(issue, customFieldDefs) : [];

	const handleDragStart = (e: React.DragEvent<HTMLDivElement>) => {
		e.dataTransfer.effectAllowed = "move";
		e.dataTransfer.setData("text/plain", issue.id);
	};

	return (
		<div
			draggable={isDraggable}
			onDragStart={isDraggable ? handleDragStart : undefined}
			onClick={onOpen}
			role="button"
			tabIndex={0}
			onKeyDown={(e) => {
				if (e.key === "Enter" || e.key === " ") {
					e.preventDefault();
					onOpen();
				}
			}}
			className={`rounded-lg bg-surface border border-text/15 shadow-sm p-3 space-y-1.5 hover:shadow-md transition-shadow cursor-pointer ${muted ? "opacity-40 grayscale" : ""}`}
		>
			<div className="flex items-center justify-between gap-2 text-[10px] font-mono text-muted">
				<span>{issue.key}</span>
				<span className="capitalize">{issue.category}</span>
			</div>
			<h4 className="text-sm font-medium text-text leading-snug line-clamp-2">{issue.title}</h4>
			{activeBadges.length > 0 && (
				<div className="flex flex-wrap gap-1">
					{activeBadges.map((b) => (
						<adc-color-label key={b.key} color={b.color} size="xs">
							{b.name}
						</adc-color-label>
					))}
				</div>
			)}
			<div className="flex items-center justify-between gap-2">
				<adc-priority-indicator
					urgency={issue.priority.urgency}
					importance={issue.priority.importance}
					difficulty={issue.priority.difficulty ?? 0}
					urgencyLabel={t("issues.urgency")}
					importanceLabel={t("issues.importance")}
					difficultyLabel={t("issues.difficulty")}
				/>
				{issue.storyPoints !== undefined && (
					<adc-badge color="gray" size="sm">
						{issue.storyPoints} SP
					</adc-badge>
				)}
			</div>
		</div>
	);
}
