import type { Block } from "@ui-library/utils/connect-rpc";
import { inputCls, labelCls, patchBlock, type ListBlock } from "./field-utils";

interface Props<T extends Block> {
	readonly block: T;
	readonly onChange: (next: T) => void;
}

export function ListFields({ block, onChange }: Props<ListBlock>) {
	const patch = (next: Partial<Omit<ListBlock, "type">>) => onChange(patchBlock(block, next));
	return (
		<div className="flex flex-col gap-2">
			<label className="flex items-center gap-2 text-sm">
				<input type="checkbox" checked={block.ordered === true} onChange={(event) => patch({ ordered: event.target.checked })} />
				<span>Ordenada</span>
			</label>
			<label className={labelCls}>
				<span>Ítems (uno por línea)</span>
				<textarea
					className={inputCls}
					rows={5}
					value={(block.items ?? []).join("\n")}
					onChange={(event) =>
						patch({
							items: event.target.value.split("\n").filter((value, index, values) => value !== "" || index < values.length - 1),
						})
					}
				/>
			</label>
			{block.ordered && (
				<label className={labelCls}>
					<span>Inicio</span>
					<input
						type="number"
						className={inputCls}
						value={block.start ?? 1}
						onChange={(event) => patch({ start: Number(event.target.value) })}
					/>
				</label>
			)}
		</div>
	);
}
