import type { Block } from "@ui-library/utils/connect-rpc";
import { inputCls, labelCls, patchBlock, type TableBlock } from "./field-utils";

interface Props<T extends Block> {
	readonly block: T;
	readonly onChange: (next: T) => void;
}

export function TableFields({ block, onChange }: Props<TableBlock>) {
	const patch = (next: Partial<Omit<TableBlock, "type">>) => onChange(patchBlock(block, next));
	return (
		<div className="flex flex-col gap-2">
			<label className={labelCls}>
				<span>Encabezados (separados por |)</span>
				<input
					className={inputCls}
					value={(block.header ?? []).join(" | ")}
					onChange={(event) => patch({ header: event.target.value.split("|").map((part) => part.trim()) })}
				/>
			</label>
			<label className={labelCls}>
				<span>Filas (una por línea, celdas separadas por |)</span>
				<textarea
					className={`${inputCls} font-mono text-sm`}
					rows={6}
					value={(block.rows ?? []).map((row) => row.join(" | ")).join("\n")}
					onChange={(event) =>
						patch({ rows: event.target.value.split("\n").map((line) => line.split("|").map((part) => part.trim())) })
					}
				/>
			</label>
			<label className={labelCls}>
				<span>Caption</span>
				<input className={inputCls} value={block.caption ?? ""} onChange={(event) => patch({ caption: event.target.value })} />
			</label>
			<label className="flex items-center gap-2 text-sm">
				<input type="checkbox" checked={block.rowHeaders === true} onChange={(event) => patch({ rowHeaders: event.target.checked })} />
				<span>Primera columna como encabezado</span>
			</label>
		</div>
	);
}
