import type { Block, CalloutRole, CalloutTone } from "@ui-library/utils/connect-rpc";
import {
	calloutRoles,
	calloutTones,
	inputCls,
	labelCls,
	patchBlock,
	titleCase,
	type CalloutBlock,
	type CodeBlock,
	type QuoteBlock,
} from "./field-utils";

interface Props<T extends Block> {
	readonly block: T;
	readonly onChange: (next: T) => void;
}

export function CodeFields({ block, onChange }: Props<CodeBlock>) {
	const patch = (next: Partial<Omit<CodeBlock, "type">>) => onChange(patchBlock(block, next));
	return (
		<div className="flex flex-col gap-2">
			<label className={labelCls}>
				<span>Lenguaje</span>
				<input
					className={inputCls}
					value={block.language ?? ""}
					onChange={(event) => patch({ language: event.target.value })}
					placeholder="typescript, bash, json..."
				/>
			</label>
			<label className={labelCls}>
				<span>Contenido</span>
				<textarea
					className={`${inputCls} font-mono text-sm`}
					rows={8}
					value={block.content ?? ""}
					onChange={(event) => patch({ content: event.target.value })}
				/>
			</label>
		</div>
	);
}

export function CalloutFields({ block, onChange }: Props<CalloutBlock>) {
	const patch = (next: Partial<Omit<CalloutBlock, "type">>) => onChange(patchBlock(block, next));
	return (
		<div className="flex flex-col gap-2">
			<label className={labelCls}>
				<span>Texto</span>
				<textarea className={inputCls} rows={3} value={block.text ?? ""} onChange={(event) => patch({ text: event.target.value })} />
			</label>
			<div className="grid grid-cols-2 gap-2">
				<label className={labelCls}>
					<span>Tono</span>
					<select
						className={inputCls}
						value={block.tone ?? "info"}
						onChange={(event) => patch({ tone: event.target.value as CalloutTone })}
					>
						{calloutTones.map((tone) => (
							<option key={tone} value={tone}>
								{titleCase(tone)}
							</option>
						))}
					</select>
				</label>
				<label className={labelCls}>
					<span>Role</span>
					<select
						className={inputCls}
						value={block.role ?? "note"}
						onChange={(event) => patch({ role: event.target.value as CalloutRole })}
					>
						{calloutRoles.map((role) => (
							<option key={role} value={role}>
								{titleCase(role)}
							</option>
						))}
					</select>
				</label>
			</div>
		</div>
	);
}

export function QuoteFields({ block, onChange }: Props<QuoteBlock>) {
	const patch = (next: Partial<Omit<QuoteBlock, "type">>) => onChange(patchBlock(block, next));
	return (
		<div className="flex flex-col gap-2">
			<label className={labelCls}>
				<span>Texto</span>
				<textarea className={inputCls} rows={3} value={block.text ?? ""} onChange={(event) => patch({ text: event.target.value })} />
			</label>
			<label className={labelCls}>
				<span>URL de fuente (opcional)</span>
				<input className={inputCls} value={block.url ?? ""} onChange={(event) => patch({ url: event.target.value })} />
			</label>
		</div>
	);
}
