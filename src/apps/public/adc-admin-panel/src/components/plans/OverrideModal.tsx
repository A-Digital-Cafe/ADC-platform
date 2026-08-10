import { useCallback, useMemo, useRef, useState } from "react";
import { identityApi } from "@ui-library/utils/api-identity";
import type { ClientUser } from "@common/types/identity/User.ts";
import type { FeatureDef, PlanSubjectType, UpsertPlanOverrideInput } from "../../utils/plans-api.ts";
import { featureOptions } from "./feature-labels.ts";
import { SUBJECT_TYPES, textToFeatureValue } from "./plan-values.ts";

interface Props {
	/** Catálogo de features registradas; vacío si el rol no puede leerlo (se cae a clave a mano). */
	readonly defs: readonly FeatureDef[];
	readonly onClose: () => void;
	readonly onSubmit: (input: UpsertPlanOverrideInput) => void;
}

/** El endpoint de búsqueda ignora consultas más cortas: no vale la pena pedirlas. */
const MIN_QUERY = 2;

/** Alta de una excepción de límite. Es un upsert: pisa la que ya exista para ese par sujeto/feature. */
export function OverrideModal({ defs, onClose, onSubmit }: Props) {
	const [subjectType, setSubjectType] = useState<PlanSubjectType>("user");
	const [subjectId, setSubjectId] = useState("");
	const [featureKey, setFeatureKey] = useState("");
	const [text, setText] = useState("");
	const [matches, setMatches] = useState<ClientUser[]>([]);
	const [searching, setSearching] = useState(false);
	const [picked, setPicked] = useState<ClientUser | null>(null);
	// Gana la última búsqueda: una respuesta vieja no puede pisar la lista de sugerencias.
	const searchSeq = useRef(0);

	const modalRef = useCallback(
		(el: HTMLElement | null) => {
			if (el) el.addEventListener("adcClose", onClose);
		},
		[onClose]
	);

	const options = useMemo(() => JSON.stringify(featureOptions(defs)), [defs]);

	const featurePickerRef = useCallback((el: HTMLElement | null) => {
		if (!el) return;
		const onPick = (e: Event) => setFeatureKey((e as CustomEvent<string>).detail);
		el.addEventListener("adcChange", onPick);
		return () => el.removeEventListener("adcChange", onPick);
	}, []);

	const search = useCallback(async (raw: string) => {
		const q = raw.trim();
		if (q.length < MIN_QUERY) {
			setMatches([]);
			return;
		}
		const mine = ++searchSeq.current;
		setSearching(true);
		const res = await identityApi.searchUsers(q);
		if (mine !== searchSeq.current) return;
		setMatches(res.success && res.data ? res.data : []);
		setSearching(false);
	}, []);

	const userSearchRef = useCallback(
		(el: HTMLElement | null) => {
			if (!el) return;
			const onInput = (e: Event) => search((e as CustomEvent<string>).detail);
			el.addEventListener("adcInput", onInput);
			return () => el.removeEventListener("adcInput", onInput);
		},
		[search]
	);

	// Cambiar de tipo de sujeto invalida el id elegido: el id de un usuario no identifica una org.
	const changeSubjectType = (next: PlanSubjectType) => {
		setSubjectType(next);
		setSubjectId("");
		setPicked(null);
		setMatches([]);
	};

	const pick = (user: ClientUser) => {
		setPicked(user);
		setSubjectId(user.id);
		setMatches([]);
	};

	const value = textToFeatureValue(text);
	const canSave = !!subjectId.trim() && !!featureKey.trim() && value !== undefined;

	const submit = (e: { preventDefault(): void }) => {
		e.preventDefault();
		if (value === undefined) return;
		onSubmit({ subjectType, subjectId: subjectId.trim(), featureKey: featureKey.trim(), value });
	};

	let subjectIdLabel = "ID del sujeto";
	if (subjectType === "org-members-default") subjectIdLabel = "ID de la organización";
	else if (subjectType === "user") subjectIdLabel = "ID del usuario";

	return (
		<adc-modal ref={modalRef} open modalTitle="Nueva excepción de límite" size="md">
			<form onSubmit={submit} className="flex flex-col gap-3">
				<adc-callout tone="info">
					El actor sale del token: en contexto organización la excepción queda scopeada a esa org y se clampea a su valor. El{" "}
					<code>-1</code> (sin tope) es exclusivo de un admin global.
				</adc-callout>

				<label className="flex flex-col gap-1 text-sm">
					<span className="font-medium text-text">Tipo de sujeto</span>
					<adc-select
						value={subjectType}
						options={JSON.stringify(SUBJECT_TYPES)}
						onChange={(e: any) => changeSubjectType(e.target.value as PlanSubjectType)}
					/>
				</label>

				{subjectType === "user" && (
					<div className="flex flex-col gap-1 text-sm">
						<span className="font-medium text-text">Buscar usuario</span>
						{/* El resultado rellena el ID de abajo, que sigue editable: pegar un id a mano
						    tiene que funcionar aunque el rol no tenga permiso de leer usuarios. */}
						<div className="relative">
							<adc-search-input ref={userSearchRef} placeholder="Username o email (mín. 2 letras)…" debounce={350} />
							{(matches.length > 0 || searching) && (
								<div className="absolute left-0 right-0 z-20 mt-1 max-h-48 overflow-y-auto rounded-xl border border-divider bg-background shadow-lg">
									{searching ? (
										<div className="flex justify-center py-3">
											<adc-spinner />
										</div>
									) : (
										matches.map((user) => (
											<button
												key={user.id}
												type="button"
												className="flex w-full cursor-pointer items-center justify-between gap-2 px-3 py-2 text-left hover:bg-surface/50"
												onClick={() => pick(user)}
											>
												<adc-user-summary username={user.username} email={user.email} />
												<span className="max-w-32 shrink-0 truncate font-mono text-[11px] text-muted" title={user.id}>
													{user.id}
												</span>
											</button>
										))
									)}
								</div>
							)}
						</div>
						{picked && (
							<p className="text-xs text-muted">
								Elegido: <span className="text-text">{picked.username}</span> ({picked.email ?? "sin email"})
							</p>
						)}
					</div>
				)}

				<label className="flex flex-col gap-1 text-sm">
					<span className="font-medium text-text">{subjectIdLabel}</span>
					<adc-input
						value={subjectId}
						placeholder="user_… / org_… / roleId"
						onInput={(e: any) => {
							setSubjectId(e.target.value);
							setPicked(null);
						}}
					/>
				</label>

				<label className="flex flex-col gap-1 text-sm">
					<span className="font-medium text-text">Feature</span>
					{defs.length > 0 ? (
						<>
							<adc-combobox
								ref={featurePickerRef}
								value={featureKey}
								placeholder="Buscá por nombre o por clave…"
								options={options}
							/>
							<span className="font-mono text-xs text-muted">{featureKey || "Ninguna elegida."}</span>
						</>
					) : (
						<adc-input value={featureKey} placeholder="drive.maxFileSize" onInput={(e: any) => setFeatureKey(e.target.value)} />
					)}
				</label>

				<label className="flex flex-col gap-1 text-sm">
					<span className="font-medium text-text">Valor</span>
					<adc-input
						value={text}
						placeholder="10 · -1 · true · basic"
						invalid={!!text.trim() && value === undefined}
						onInput={(e: any) => setText(e.target.value)}
					/>
					<span className="text-xs text-muted">Número, true/false o texto para las enum. Acá no valen los valores por asiento.</span>
				</label>

				<div slot="footer" className="flex justify-end gap-2">
					<adc-button variant="accent-outlined" type="button" label="Cancelar" onClick={onClose} />
					<adc-button variant="primary" type="submit" label="Guardar excepción" disabled={!canSave} />
				</div>
			</form>
		</adc-modal>
	);
}
