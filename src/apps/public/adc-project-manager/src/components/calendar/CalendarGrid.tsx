import { useMemo, useState } from "react";
import { useTranslation } from "@ui-library/utils/i18n-react";
import type { Project } from "@common/types/project-manager/Project.ts";
import type { Issue } from "@common/types/project-manager/Issue.ts";

interface Props {
	project: Project;
	issues: Issue[];
	startDate: Date;
	endDate: Date;
	onOpen: (issue: Issue) => void;
}

const WEEKS_VISIBLE = 3;
const DAYS_VISIBLE = WEEKS_VISIBLE * 7;

/** Devuelve la fecha a la que "pertenece" un issue en el calendario. */
function dateForIssue(issue: Issue, rangeEnd: Date): Date {
	if (issue.closedAt) return new Date(issue.closedAt);
	return rangeEnd;
}

function toDayKey(d: Date): string {
	return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function startOfDay(d: Date): Date {
	return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/** Domingo de la semana a la que pertenece `d`. */
function startOfWeekSunday(d: Date): Date {
	const day = startOfDay(d);
	day.setDate(day.getDate() - day.getDay());
	return day;
}

function addDays(d: Date, delta: number): Date {
	const out = new Date(d);
	out.setDate(out.getDate() + delta);
	return out;
}

function enumerateDays(from: Date, count: number): Date[] {
	const out: Date[] = [];
	for (let i = 0; i < count; i++) out.push(addDays(from, i));
	return out;
}

/**
 * Calendario con ventana deslizante alineada Domingo→Sábado.
 * Ventana por defecto: 1 semana atrás + semana actual + 2 semanas adelante (3 semanas).
 * Issues con `closedAt` se ubican en su día; los pendientes se agrupan en el
 * `endDate` del rango (sprint/milestone) solo si cae dentro de la ventana.
 */
export function CalendarGrid({ project, issues, endDate, onOpen }: Readonly<Props>) {
	const { t } = useTranslation({ namespace: "adc-project-manager" });

	const defaultStart = useMemo(() => addDays(startOfWeekSunday(new Date()), -7), []);
	const [viewStart, setViewStart] = useState<Date>(defaultStart);

	const today = startOfDay(new Date());
	const endDay = startOfDay(endDate);
	const isOverdue = today > endDay;

	const days = useMemo(() => enumerateDays(viewStart, DAYS_VISIBLE), [viewStart]);
	const viewEnd = days[days.length - 1];

	const byDay = useMemo(() => {
		const map = new Map<string, Issue[]>();
		const endKey = toDayKey(endDay);
		const inWindow = endDay >= viewStart && endDay <= viewEnd;
		for (const issue of issues) {
			const date = dateForIssue(issue, endDate);
			const key = toDayKey(date);
			if (!issue.closedAt) {
				if (!inWindow || key !== endKey) continue;
			} else if (date < viewStart || date > viewEnd) {
				continue;
			}
			const arr = map.get(key) ?? [];
			arr.push(issue);
			map.set(key, arr);
		}
		return map;
	}, [issues, endDate, endDay, viewStart, viewEnd]);

	const columnByKey = useMemo(() => {
		const m = new Map<string, (typeof project.kanbanColumns)[number]>();
		for (const c of project.kanbanColumns) m.set(c.key, c);
		return m;
	}, [project.kanbanColumns]);

	const weekdayHeaders = useMemo(() => days.slice(0, 7).map((d) => d.toLocaleDateString(undefined, { weekday: "short" })), [days]);

	const goPrev = () => setViewStart((prev) => addDays(prev, -7));
	const goNext = () => setViewStart((prev) => addDays(prev, 7));
	const goToday = () => setViewStart(defaultStart);

	const endKey = toDayKey(endDay);
	const todayKey = toDayKey(today);

	return (
		<div className="space-y-2">
			<div className="text-xs text-muted flex items-center gap-2">
				<button
					type="button"
					onClick={goPrev}
					aria-label={t("calendar.prev")}
					className="px-2 py-1 rounded border border-border hover:bg-surface/60"
				>
					←
				</button>
				<button type="button" onClick={goToday} className="px-2 py-1 rounded border border-border hover:bg-surface/60">
					{t("calendar.today")}
				</button>
				<button
					type="button"
					onClick={goNext}
					aria-label={t("calendar.next")}
					className="px-2 py-1 rounded border border-border hover:bg-surface/60"
				>
					→
				</button>
				<span>{viewStart.toLocaleDateString()}</span>
				<span>→</span>
				<span>{viewEnd.toLocaleDateString()}</span>
				<span className="ml-auto">{t("calendar.daysTotal", { count: String(DAYS_VISIBLE) })}</span>
			</div>
			<div className="grid grid-cols-7 gap-1">
				{weekdayHeaders.map((label, idx) => {
					const isWeekend = idx === 0 || idx === 6;
					return (
						<div
							key={`hdr-${idx}`}
							className={`text-[10px] uppercase font-semibold text-center py-1 ${isWeekend ? "text-muted" : "text-text"}`}
						>
							{label}
						</div>
					);
				})}
				{days.map((day) => {
					const key = toDayKey(day);
					const dayIssues = byDay.get(key) ?? [];
					const isEndDay = key === endKey;
					const isToday = key === todayKey;
					const weekday = day.getDay();
					const isWeekend = weekday === 0 || weekday === 6;
					const cellTone = isWeekend ? "bg-muted/10" : "bg-surface/40";
					const todayRing = isToday ? "ring-2 ring-primary/60" : "";
					return (
						<div
							key={key}
							className={`border border-border rounded-md p-1.5 min-h-22.5 flex flex-col gap-1 ${cellTone} ${todayRing}`}
						>
							<div className={`text-[10px] flex items-center justify-between ${isWeekend ? "text-muted" : "text-text/80"}`}>
								<span>{day.getDate()}</span>
								{isEndDay && <span className="text-[9px] uppercase text-tdanger/80">{t("calendar.dueLabel")}</span>}
							</div>
							{dayIssues.map((issue) => {
								const col = columnByKey.get(issue.columnKey);
								const pendingAtEnd = isEndDay && !issue.closedAt;
								const toneCls = pendingAtEnd
									? isOverdue
										? "bg-tdanger/15 border-tdanger/40 text-tdanger"
										: "bg-muted/10 border-muted/30 text-muted"
									: col?.isDone
										? "bg-tsuccess/15 border-tsuccess/40 text-tsuccess"
										: "bg-tinfo/15 border-tinfo/40 text-tinfo";
								return (
									<button
										key={issue.id}
										type="button"
										onClick={() => onOpen(issue)}
										className={`text-[10px] font-mono px-1.5 py-0.5 rounded border text-left truncate ${toneCls}`}
										title={issue.title}
									>
										{issue.key}
									</button>
								);
							})}
						</div>
					);
				})}
			</div>
		</div>
	);
}
