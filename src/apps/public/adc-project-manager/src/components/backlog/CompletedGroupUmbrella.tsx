import { useTranslation } from "@ui-library/utils/i18n-react";
import type { ReactNode } from "react";
import type { GroupSection } from "./BacklogSection.tsx";

interface Props {
	sections: GroupSection[];
	isCollapsed: boolean;
	onToggleCollapsed: () => void;
	renderSection: (section: GroupSection, defaultCollapsed: boolean) => ReactNode;
}

/**
 * Paraguas colapsable que agrupa todas las secciones `isCompleted`.
 * Se renderiza por default colapsado para no distraer del trabajo en curso.
 */
export function CompletedGroupUmbrella({ sections, isCollapsed, onToggleCollapsed, renderSection }: Readonly<Props>) {
	const { t } = useTranslation({ namespace: "adc-project-manager" });
	if (!sections.length) return null;
	const totalIssues = sections.reduce((acc, s) => acc + s.issues.length, 0);
	return (
		<section className="border border-text/15 rounded-md">
			<button
				type="button"
				className="w-full flex items-center gap-2 text-left py-2 px-2 hover:bg-surface-alt"
				onClick={onToggleCollapsed}
				aria-expanded={!isCollapsed}
			>
				<span className="text-muted text-xs w-4">{isCollapsed ? "▶" : "▼"}</span>
				<h4 className="font-heading text-sm font-semibold text-muted uppercase tracking-wide">{t("issues.completedGroup")}</h4>
				<span className="text-muted text-xs">
					({sections.length} · {totalIssues})
				</span>
			</button>
			{!isCollapsed && <div className="px-3 pb-3 space-y-3">{sections.map((s) => renderSection(s, true))}</div>}
		</section>
	);
}
