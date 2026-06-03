import type { Block, TextAlign } from "@ui-library/utils/connect-rpc";
import { alignLabel, inputCls, labelCls, patchBlock, textAligns, textMarks, type CheckboxBlock } from "./field-utils";
interface Props<T extends Block> {
	readonly block: T;
	readonly onChange: (next: T) => void;
}
export function CheckboxFields({ block, onChange }: Props<CheckboxBlock>) {
	const patch = (next: Partial<Omit<CheckboxBlock, "type">>) => onChange(patchBlock(block, next));
	return (
		<div className="flex flex-col gap-2">
			<label className="flex items-center gap-2 text-sm font-medium">
				<input
					type="checkbox"
					checked={block.checked ?? false}
					onChange={(event) => patch({ checked: event.target.checked })}
					className="w-4 h-4 accent-primary"
				/>
				<span>Activo / Completado</span>
			</label>
			<label className={labelCls}>
				<span>Texto</span>
				<textarea className={inputCls} rows={2} value={block.text ?? ""} onChange={(event) => patch({ text: event.target.value })} />
			</label>
			<label className={labelCls}>
				<span>Alineación</span>
				<select
					className={inputCls}
					value={block.align ?? "left"}
					onChange={(event) => patch({ align: event.target.value as TextAlign })}
				>
					{textAligns.map((align) => (
						<option key={align} value={align}>
							{alignLabel(align)}
						</option>
					))}
				</select>
			</label>
			<fieldset className="flex gap-3 text-sm">
				<legend className="sr-only">Marcas</legend>
				{textMarks.map((mark) => {
					const marks = block.marks ?? [];
					const active = marks.includes(mark);
					return (
						<label key={mark} className="flex items-center gap-1">
							<input
								type="checkbox"
								checked={active}
								onChange={(event) =>
									patch({ marks: event.target.checked ? [...marks, mark] : marks.filter((item) => item !== mark) })
								}
							/>
							<span>{mark}</span>
						</label>
					);
				})}
			</fieldset>
		</div>
	);
}
