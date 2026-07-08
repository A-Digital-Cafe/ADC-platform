import React, { useState, useCallback, useRef } from "react";
import { useTranslation } from "@ui-library/utils/i18n-react";

export interface Column<T> {
	key: string;
	label: string;
	render?: (item: T) => React.ReactNode;
	sortable?: boolean;
}

interface DataTableProps<T> {
	readonly columns: Column<T>[];
	readonly data: T[];
	readonly loading?: boolean;
	readonly searchPlaceholder?: string;
	readonly onSearch?: (query: string) => void;
	readonly onAdd?: () => void;
	readonly addLabel?: string;
	readonly actions?: (item: T) => React.ReactNode;
	readonly keyExtractor: (item: T) => string;
	readonly emptyMessage?: string;
	readonly pageSize?: number;
	/** Modo server-side: `data` es la página actual ya recortada y `total` el total remoto. */
	readonly total?: number;
	/** Página actual (1-based) en modo server-side; la controla el padre. */
	readonly page?: number;
	readonly onPageChange?: (page: number) => void;
	/** Debounce (ms) del buscador; útil cuando `onSearch` dispara requests al server. */
	readonly searchDebounce?: number;
}

export function DataTable<T>({
	columns,
	data,
	loading,
	searchPlaceholder,
	onSearch,
	onAdd,
	addLabel,
	actions,
	keyExtractor,
	emptyMessage,
	pageSize = 10,
	total,
	page,
	onPageChange,
	searchDebounce,
}: DataTableProps<T>) {
	const { t } = useTranslation({ namespace: "adc-identity", autoLoad: true });
	const [currentPage, setCurrentPage] = useState(1);
	const [searchQuery, setSearchQuery] = useState("");

	// Server-side: el padre pagina (data = página actual); client-side: se recorta acá.
	const serverMode = total !== undefined && onPageChange !== undefined;
	const totalPages = Math.ceil((serverMode ? total : data.length) / pageSize);
	const effectivePage = serverMode ? (page ?? 1) : currentPage;
	const startIdx = (currentPage - 1) * pageSize;
	const paginatedData = serverMode ? data : data.slice(startIdx, startIdx + pageSize);

	// Keep latest callbacks in refs to avoid stale closures in event listeners
	const onSearchRef = useRef(onSearch);
	onSearchRef.current = onSearch;
	const onPageChangeRef = useRef(onPageChange);
	onPageChangeRef.current = onPageChange;

	const searchRef = useCallback((el: HTMLElement | null) => {
		if (el) {
			el.addEventListener("adcInput", (e: Event) => {
				const value = (e as CustomEvent<string>).detail ?? (e.target as HTMLInputElement).value;
				setSearchQuery(value);
				setCurrentPage(1);
				onSearchRef.current?.(value);
			});
		}
	}, []);
	const paginationRef = useCallback((el: HTMLElement | null) => {
		if (el)
			el.addEventListener("adcPageChange", (e: Event) => {
				const nextPage = (e as CustomEvent<number>).detail;
				setCurrentPage(nextPage);
				onPageChangeRef.current?.(nextPage);
			});
	}, []);

	if (loading) {
		return (
			<div className="space-y-3">
				<adc-skeleton variant="rectangular" height="48px" />
				<adc-skeleton variant="rectangular" height="300px" />
			</div>
		);
	}

	return (
		<div className="space-y-4">
			{/* Toolbar */}
			<div className="flex items-center justify-between gap-4 flex-wrap">
				{onSearch && (
					<div className="flex-1 min-w-50 max-w-sm">
						<adc-search-input
							ref={searchRef}
							value={searchQuery}
							debounce={searchDebounce}
							placeholder={searchPlaceholder || t("common.search")}
						/>
					</div>
				)}
				{onAdd && (
					<adc-button variant="primary" onClick={onAdd}>
						{addLabel || t("common.add")}
					</adc-button>
				)}
			</div>

			{/* Table */}
			<div className="overflow-x-auto rounded-xxl border border-accent/20 shadow-cozy">
				<table className="w-full min-w-160 text-sm">
					<thead>
						<tr className="bg-header border-b border-accent/20">
							{columns.map((col) => (
								<th key={col.key} className="px-4 py-3 text-left font-heading font-semibold text-text whitespace-nowrap">
									{col.label}
								</th>
							))}
							{actions && <th className="px-4 py-3 text-right font-heading font-semibold text-text">{t("common.actions")}</th>}
						</tr>
					</thead>
					<tbody>
						{paginatedData.length === 0 ? (
							<tr>
								<td colSpan={columns.length + (actions ? 1 : 0)} className="px-4 py-8 text-center text-muted">
									{emptyMessage || t("common.noData")}
								</td>
							</tr>
						) : (
							paginatedData.map((item) => (
								<tr key={keyExtractor(item)} className="border-b border-accent/20 hover:bg-surface/20 transition-colors">
									{columns.map((col) => (
										<td key={col.key} className="px-4 py-3 text-text">
											{col.render ? col.render(item) : (item as any)[col.key]}
										</td>
									))}
									{actions && (
										<td className="px-4 py-3 text-right">
											<div className="flex items-center justify-end gap-1">{actions(item)}</div>
										</td>
									)}
								</tr>
							))
						)}
					</tbody>
				</table>
			</div>

			{/* Pagination */}
			{totalPages > 1 && (
				<div className="flex justify-center">
					<adc-pagination ref={paginationRef} currentPage={effectivePage} totalPages={totalPages} />
				</div>
			)}
		</div>
	);
}
