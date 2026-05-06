import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "@ui-library/utils/i18n-react";
import { identityPmApi } from "../../utils/identity-api.ts";
import { ClientUser } from "@common/types/identity/User.ts";

interface Props {
	readonly selectedIds: string[];
	readonly onChange: (ids: string[]) => void;
	readonly disabled?: boolean;
	readonly label?: string;
	readonly initialCache?: Record<string, { username?: string; avatar?: string }>;
}

/**
 * Picker multi de usuarios contra Identity. Usa `adc-search-input` con debounce
 * para consultar `/api/identity/users/search` y mantiene un cache local de los
 * chips ya seleccionados para poder mostrar el nombre sin re-fetchear.
 */
export function UserPicker({ selectedIds, onChange, disabled, label, initialCache }: Props) {
	const { t } = useTranslation({ namespace: "adc-project-manager" });
	const [results, setResults] = useState<ClientUser[]>([]);
	const [searching, setSearching] = useState(false);
	const [cache, setCache] = useState<Record<string, ClientUser>>(() => {
		if (!initialCache) return {};
		const seed: Record<string, ClientUser> = {};
		for (const [id, p] of Object.entries(initialCache)) {
			seed[id] = { id, username: p.username ?? "", avatar: p.avatar } as ClientUser;
		}
		return seed;
	});
	const searchRef = useRef<HTMLElement | null>(null);

	// Re-sembrar cache cuando llegan nuevos perfiles desde el caller (ej: el
	// issue se recarga). Solo agrega/sobrescribe los IDs presentes en
	// `initialCache`; preserva cualquier ID que el usuario haya buscado/agregado
	// localmente en esta sesión.
	useEffect(() => {
		if (!initialCache) return;
		setCache((prev) => {
			let changed = false;
			const next = { ...prev };
			for (const [id, p] of Object.entries(initialCache)) {
				const existing = next[id];
				if (!existing || (existing.username === "" && p.username) || existing.avatar !== p.avatar) {
					next[id] = { id, username: p.username ?? existing?.username ?? "", avatar: p.avatar ?? existing?.avatar } as ClientUser;
					changed = true;
				}
			}
			return changed ? next : prev;
		});
	}, [initialCache]);

	// Pre-hidrata nombres para IDs seleccionados que aún no estén en cache.
	// Para evitar un bucle infinito si `getUser` falla (401, 404, 429), todo
	// ID intentado se marca en cache (con un placeholder si falló) — así
	// nunca volverá a aparecer en `missing` aunque la request no haya
	// completado con éxito.
	useEffect(() => {
		const missing = selectedIds.filter((id) => !cache[id]);
		if (missing.length === 0) return;
		let cancelled = false;
		(async () => {
			const updates: Record<string, ClientUser> = {};
			await Promise.all(
				missing.map(async (id) => {
					const r = await identityPmApi.getUser(id);
					if (r.success && r.data) updates[id] = r.data;
				})
			);
			if (cancelled) return;
			setCache((prev) => {
				const next = { ...prev, ...updates };
				// Marcar como "intentado" todo ID que no haya devuelto datos para
				// no re-disparar el effect en bucle cuando hay errores persistentes.
				for (const id of missing) {
					if (!next[id]) next[id] = { id } as ClientUser;
				}
				return next;
			});
		})();
		return () => {
			cancelled = true;
		};
	}, [selectedIds, cache]);

	const handleSearch = useCallback(async (query: string) => {
		if (!query || query.length < 2) {
			setResults([]);
			return;
		}
		setSearching(true);
		const res = await identityPmApi.searchUsers(query);
		if (res.success && res.data) setResults(res.data);
		setSearching(false);
	}, []);

	const attachRef = useCallback(
		(el: HTMLElement | null) => {
			searchRef.current = el;
			if (el) el.addEventListener("adcInput", (e: Event) => handleSearch((e as CustomEvent<string>).detail));
		},
		[handleSearch]
	);

	const add = (user: ClientUser) => {
		if (selectedIds.includes(user.id)) return;
		setCache((prev) => ({ ...prev, [user.id]: user }));
		onChange([...selectedIds, user.id]);
		setResults([]);
	};
	const remove = (id: string) => onChange(selectedIds.filter((x) => x !== id));

	return (
		<div className="space-y-2">
			{label && <label className="block text-sm font-medium text-text">{label}</label>}
			{!disabled && (
				<div className="relative">
					<adc-search-input ref={attachRef} placeholder={t("settings.searchUsers")} debounce={350} />
					{(results.length > 0 || searching) && (
						<div className="absolute z-20 left-0 right-0 mt-1 bg-background border border-surface rounded-xl shadow-lg max-h-48 overflow-y-auto">
							{searching ? (
								<div className="flex justify-center py-3">
									<adc-spinner />
								</div>
							) : (
								results
									.filter((u) => !selectedIds.includes(u.id))
									.map((u) => (
										<button
											key={u.id}
											type="button"
											className="w-full text-left px-3 py-2 hover:bg-surface/50 transition-colors cursor-pointer flex items-center justify-between"
											onClick={() => add(u)}
										>
											<adc-user-summary username={u.username} email={u.email} />
											<adc-icon-plus size="1rem" />
										</button>
									))
							)}
						</div>
					)}
				</div>
			)}
			{selectedIds.length === 0 && <p className="text-xs text-muted">{t("settings.noMembers")}</p>}
			{selectedIds.length > 0 && (
				<ul className="divide-y divide-surface">
					{selectedIds.map((id) => {
						const u = cache[id];
						return (
							<li key={id} className="flex items-center justify-between py-2">
								<adc-user-summary username={u?.username || id} email={u?.email} />
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
