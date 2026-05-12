import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "@ui-library/utils/i18n-react";
import { identityPmApi } from "../../utils/identity-api.ts";
import { ClientGroup } from "@common/types/identity/Group.ts";

interface Props {
	readonly selectedIds: string[];
	readonly onChange: (ids: string[]) => void;
	readonly orgId?: string | null;
	readonly disabled?: boolean;
	readonly label?: string;
	/**
	 * Perfiles ya resueltos por el backend (`groupId → { name, description? }`),
	 * usados como cache inicial para mostrar nombre + descripción de los grupos
	 * ya seleccionados sin pegarle a `/api/identity/groups`.
	 */
	readonly resolvedById?: Record<string, { name: string; description?: string }>;
}

/**
 * Picker multi de grupos contra Identity. Mismo patrón que `UserPicker`: usa
 * `adc-search-input` con debounce para consultar `/api/identity/groups/search`
 * y mantiene un cache local de los chips ya seleccionados para mostrar el
 * nombre sin re-fetchear.
 */
export function GroupPicker({ selectedIds, onChange, orgId, disabled, label, resolvedById }: Readonly<Props>) {
	const { t } = useTranslation({ namespace: "adc-project-manager" });
	const [results, setResults] = useState<ClientGroup[]>([]);
	const [searching, setSearching] = useState(false);
	const [cache, setCache] = useState<Record<string, ClientGroup>>(() => {
		if (!resolvedById) return {};
		const seed: Record<string, ClientGroup> = {};
		for (const [id, p] of Object.entries(resolvedById)) {
			seed[id] = { id, name: p.name ?? "", description: p.description };
		}
		return seed;
	});
	const searchRef = useRef<HTMLElement | null>(null);

	// Re-sembrar cache cuando llegan nuevos perfiles desde el caller (ej: el
	// issue se recarga). Solo agrega/sobrescribe los IDs presentes en
	// `resolvedById`; preserva cualquier ID que el usuario haya buscado/agregado
	// localmente en esta sesión.
	useEffect(() => {
		if (!resolvedById) return;
		setCache((prev) => {
			let changed = false;
			const next = { ...prev };
			for (const [id, p] of Object.entries(resolvedById)) {
				const existing = next[id];
				if (!existing || (existing.name === "" && p.name) || existing.description !== p.description) {
					next[id] = {
						id,
						name: p.name ?? existing?.name ?? "",
						description: p.description ?? existing?.description,
					} as ClientGroup;
					changed = true;
				}
			}
			return changed ? next : prev;
		});
	}, [resolvedById]);

	// Hidrata nombres para IDs seleccionados que aún no estén en cache. Sin
	// endpoint público batch para grupos, marcamos cada ID intentado con un
	// placeholder `{ id, name: "" }` para evitar bucles si el lookup futuro
	// fallara (mismo patrón anti-loop que `UserPicker`).
	useEffect(() => {
		const missing = selectedIds.filter((id) => !cache[id]);
		if (missing.length === 0) return;
		// No hay endpoint `getGroup(id)` desde `identityPmApi`; los grupos no
		// resueltos quedan con placeholder y se mostrarán por id.
		setCache((prev) => {
			const next = { ...prev };
			for (const id of missing) {
				if (!next[id]) next[id] = { id, name: "" } as ClientGroup;
			}
			return next;
		});
	}, [selectedIds, cache]);

	const handleSearch = useCallback(
		async (query: string) => {
			if (!query || query.length < 2) {
				setResults([]);
				return;
			}
			setSearching(true);
			const res = await identityPmApi.searchGroups(query, orgId ?? undefined);
			if (res.success && res.data) setResults(res.data);
			setSearching(false);
		},
		[orgId]
	);

	const attachRef = useCallback(
		(el: HTMLElement | null) => {
			searchRef.current = el;
			if (el) el.addEventListener("adcInput", (e: Event) => handleSearch((e as CustomEvent<string>).detail));
		},
		[handleSearch]
	);

	const add = (group: ClientGroup) => {
		if (selectedIds.includes(group.id)) return;
		setCache((prev) => ({ ...prev, [group.id]: group }));
		onChange([...selectedIds, group.id]);
		setResults([]);
	};
	const remove = (id: string) => onChange(selectedIds.filter((x) => x !== id));

	return (
		<div className="space-y-2">
			{label && <label className="block text-sm font-medium text-text">{label}</label>}
			{!disabled && (
				<div className="relative">
					<adc-search-input ref={attachRef} placeholder={t("settings.searchGroups") ?? "Buscar grupos..."} debounce={350} />
					{(results.length > 0 || searching) && (
						<div className="absolute z-20 left-0 right-0 mt-1 bg-background border border-surface rounded-xl shadow-lg max-h-48 overflow-y-auto">
							{searching ? (
								<div className="flex justify-center py-3">
									<adc-spinner />
								</div>
							) : (
								results
									.filter((g) => !selectedIds.includes(g.id))
									.map((g) => (
										<button
											key={g.id}
											type="button"
											className="w-full text-left px-3 py-2 hover:bg-surface/50 transition-colors cursor-pointer flex items-center justify-between"
											onClick={() => add(g)}
										>
											<div className="flex flex-col min-w-0">
												<span className="truncate text-sm">{g.name}</span>
												{g.description && <span className="truncate text-xs text-muted">{g.description}</span>}
											</div>
											<adc-icon-plus size="1rem" />
										</button>
									))
							)}
						</div>
					)}
				</div>
			)}
			{selectedIds.length === 0 && <p className="text-xs text-muted">{t("settings.noGroupsAssigned") ?? t("settings.noGroups")}</p>}
			{selectedIds.length > 0 && (
				<ul className="divide-y divide-surface">
					{selectedIds.map((id) => {
						const g = cache[id];
						const display = g?.name || id;
						return (
							<li key={id} className="flex items-center justify-between py-2">
								<div className="flex flex-col min-w-0">
									<span className="truncate text-sm">{display}</span>
									{g?.description && <span className="truncate text-xs text-muted">{g.description}</span>}
								</div>
								{!disabled && (
									<adc-button-rounded variant="danger" aria-label={t("common.delete")} onClick={() => remove(id)} size="md">
										<adc-icon-close size="0.875rem" />
									</adc-button-rounded>
								)}
							</li>
						);
					})}
				</ul>
			)}
		</div>
	);
}
