import { useCallback, useMemo, useState } from "react";
import type { FeatureDef } from "../../utils/plans-api.ts";
import { featureHint, featureLabel, featureOptions, groupByModule } from "./feature-labels.ts";

interface Props {
	readonly label: string;
	readonly help: string;
	/** Texto crudo por clave: se guarda sin parsear para no perder lo que el usuario tipeó. */
	readonly values: Record<string, string>;
	readonly invalid: readonly string[];
	/** Catálogo de features registradas: da nombre, descripción y grupo a cada clave. */
	readonly defs: readonly FeatureDef[];
	readonly onChange: (next: Record<string, string>) => void;
}

/** Grupo ya resuelto para pintar: sus claves presentes en el plan, en orden de lectura. */
interface Section {
	id: string;
	label: string;
	keys: { key: string; name: string; hint: string }[];
}

/**
 * Editor clave → valor de un mapa de features, agrupado por la aplicación dueña (mismo
 * criterio que la página pública de precios).
 *
 * No hay botón de quitar a propósito: el backend hace **merge** por clave, así que
 * borrar una fila acá no borraría nada en el plan. Para desactivar una feature hay
 * que ponerle el valor que corresponda (`0`, `false`).
 */
export function FeatureMapEditor({ label, help, values, invalid, defs, onChange }: Props) {
	const [manualKey, setManualKey] = useState("");

	// Las claves del plan que el catálogo no conoce igual se editan: son features de un
	// módulo que todavía no arrancó (o que dejó de registrarlas) y su valor sigue guardado.
	const sections = useMemo<Section[]>(() => {
		const present = new Set(Object.keys(values));
		const known = new Set(defs.map((d) => d.key));
		const sections = groupByModule(defs.filter((d) => present.has(d.key)))
			.map((group) => ({
				id: group.id,
				label: group.label,
				keys: group.defs.map((def) => ({ key: def.key, name: featureLabel(def), hint: featureHint(def) })),
			}))
			.filter((section) => section.keys.length > 0);

		const orphans = [...present].filter((key) => !known.has(key)).sort((a, b) => a.localeCompare(b));
		if (orphans.length > 0) {
			sections.push({
				id: "__orphans",
				label: "Sin registrar (ningún módulo cargado las declara)",
				keys: orphans.map((key) => ({ key, name: key, hint: "" })),
			});
		}
		return sections;
	}, [values, defs]);

	// Sólo se ofrece agregar lo que el catálogo declara: una clave inventada se guardaría
	// pero no la consultaría nadie.
	const addable = useMemo(() => featureOptions(defs.filter((d) => !(d.key in values))), [defs, values]);
	const addableJson = useMemo(() => JSON.stringify(addable), [addable]);

	const add = useCallback(
		(key: string) => {
			const clean = key.trim();
			if (!clean || clean in values) return;
			onChange({ ...values, [clean]: "" });
			setManualKey("");
		},
		[values, onChange]
	);

	// `adc-combobox` sólo emite `adcChange`; el ref devuelve su limpieza (React 19).
	const pickerRef = useCallback(
		(el: HTMLElement | null) => {
			if (!el) return;
			const onPick = (e: Event) => add((e as CustomEvent<string>).detail);
			el.addEventListener("adcChange", onPick);
			return () => el.removeEventListener("adcChange", onPick);
		},
		[add]
	);

	return (
		<section className="flex flex-col gap-2">
			<div>
				<h3 className="text-sm font-medium text-text">{label}</h3>
				<p className="text-xs text-muted">{help}</p>
			</div>
			<div className="flex max-h-96 flex-col gap-3 overflow-y-auto rounded-md border border-divider p-3">
				{sections.length === 0 && <p className="text-xs text-muted">Sin valores.</p>}
				{sections.map((section) => (
					<div key={section.id} className="flex flex-col gap-1">
						<p className="text-[11px] font-semibold uppercase tracking-wide text-muted">{section.label}</p>
						{section.keys.map(({ key, name, hint }) => (
							<div key={key} className="flex items-center gap-3">
								{/* Clave y pista en renglones propios: juntas no entran en media columna y lo
								    que se cortaba era la pista, que es justo lo que dice qué valor escribir. */}
								<div className="min-w-0 w-3/5">
									<p className="truncate text-sm text-text" title={name}>
										{name}
									</p>
									{/* La pista envuelve en vez de recortarse: es la única línea que hace falta
									    leer entera y algunas no entran en un renglón por más ancha que sea la columna. */}
									{hint && <p className="text-[11px] text-muted">{hint}</p>}
									{name !== key && (
										<p className="truncate font-mono text-[11px] text-muted" title={key}>
											{key}
										</p>
									)}
								</div>
								<div className="flex-1">
									<adc-input
										value={values[key]}
										placeholder="10 · -1 · true · basic"
										invalid={invalid.includes(key)}
										onInput={(e: any) => onChange({ ...values, [key]: e.target.value })}
									/>
								</div>
							</div>
						))}
					</div>
				))}
			</div>

			{defs.length > 0 ? (
				<label className="flex flex-col gap-1 text-xs text-muted">
					<span>
						Agregar feature{" "}
						{addable.length === 0 && <span className="text-text">— el plan ya tiene todas las registradas.</span>}
					</span>
					{addable.length > 0 && (
						<adc-combobox ref={pickerRef} value="" placeholder="Buscá por nombre o por clave…" options={addableJson} clearable={false} />
					)}
				</label>
			) : (
				// Sin catálogo no hay nada que sugerir (el PlanService no devolvió features):
				// queda el alta a mano para no bloquear la edición.
				<div className="flex items-center gap-2">
					<div className="flex-1">
						<adc-input
							value={manualKey}
							placeholder="nueva feature (ej. drive.maxFileSize)"
							onInput={(e: any) => setManualKey(e.target.value)}
						/>
					</div>
					<adc-button
						size="small"
						variant="accent-outlined"
						type="button"
						label="Agregar"
						disabled={!manualKey.trim()}
						onClick={() => add(manualKey)}
					/>
				</div>
			)}
		</section>
	);
}
