import type { Block, TextAlign } from "@ui-library/utils/connect-rpc";
import {
	alignLabel,
	headingLevels,
	inputCls,
	labelCls,
	patchBlock,
	textAligns,
	textMarks,
	type HeadingBlock,
	type ParagraphBlock,
} from "./field-utils";

interface Props<T extends Block> {
	readonly block: T;
	readonly onChange: (next: T) => void;
}

export function HeadingFields({ block, onChange }: Props<HeadingBlock>) {
	const patch = (next: Partial<Omit<HeadingBlock, "type">>) => onChange(patchBlock(block, next));
	return (
		<div className="flex flex-col gap-2">
			<label className={labelCls}>
				<span>Texto</span>
				<input className={inputCls} value={block.text ?? ""} onChange={(event) => patch({ text: event.target.value })} />
			</label>
			<div className="grid grid-cols-3 gap-2">
				<label className={labelCls}>
					<span>Nivel</span>
					<select
						className={inputCls}
						value={block.level ?? 2}
						onChange={(event) => patch({ level: Number(event.target.value) as HeadingBlock["level"] })}
					>
						{headingLevels.map((level) => (
							<option key={level} value={level}>
								H{level}
							</option>
						))}
					</select>
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
				<label className={labelCls}>
					<span>ID (ancla)</span>
					<input className={inputCls} value={block.id ?? ""} onChange={(event) => patch({ id: event.target.value })} />
				</label>
			</div>
		</div>
	);
}
export function ParagraphFields({ block, onChange }: Props<ParagraphBlock>) {
	const patch = (next: Partial<Omit<ParagraphBlock, "type">>) => onChange(patchBlock(block, next));
	return (
		<div className="flex flex-col gap-2">
			<label className={labelCls}>
				<span>Texto</span>
				<textarea className={inputCls} rows={4} value={block.text ?? ""} onChange={(event) => patch({ text: event.target.value })} />
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
