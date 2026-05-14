import { useEffect, useRef, useState } from "react";
import type { Block } from "@ui-library/utils/connect-rpc";
import { BlockFields } from "./BlockFields";

interface Props {
	readonly value: string;
	readonly onChange: (text: string, parsed: Block[] | null) => void;
}

type BlockType = Block["type"];

interface BlockTypeOption {
	readonly type: BlockType;
	readonly label: string;
	readonly icon: string;
	readonly create: () => Block;
}

const BLOCK_TYPES: readonly BlockTypeOption[] = [
	{ type: "heading", label: "Encabezado", icon: "H", create: () => ({ type: "heading", level: 2, text: "Nuevo título" }) },
	{ type: "paragraph", label: "Párrafo", icon: "¶", create: () => ({ type: "paragraph", text: "Escribe aquí..." }) },
	{ type: "list", label: "Lista", icon: "•", create: () => ({ type: "list", ordered: false, items: ["Ítem 1"] }) },
	{
		type: "code",
		label: "Código",
		icon: "</>",
		create: () => ({ type: "code", language: "typescript", content: "// código" }),
	},
	{
		type: "callout",
		label: "Callout",
		icon: "!",
		create: () => ({ type: "callout", tone: "info", role: "note", text: "Nota destacada" }),
	},
	{ type: "quote", label: "Cita", icon: "❝", create: () => ({ type: "quote", text: "Texto citado" }) },
	{
		type: "table",
		label: "Tabla",
		icon: "⊞",
		create: () => ({ type: "table", header: ["Col 1", "Col 2"], rows: [["a", "b"]] }),
	},
	{ type: "divider", label: "Divisor", icon: "—", create: () => ({ type: "divider" }) },
];

function parseBlocks(text: string): { blocks: Block[]; error: string } {
	const trimmed = text.trim();
	if (!trimmed) return { blocks: [], error: "" };
	try {
		const parsed = JSON.parse(trimmed);
		if (!Array.isArray(parsed)) return { blocks: [], error: "El JSON debe ser un array" };
		return { blocks: parsed as Block[], error: "" };
	} catch (e) {
		return { blocks: [], error: e instanceof Error ? e.message : "JSON inválido" };
	}
}

function serialize(blocks: Block[]): string {
	return blocks.length ? JSON.stringify(blocks, null, 2) : "";
}

export function BlocksEditor({ value, onChange }: Props) {
	const [blocks, setBlocks] = useState<Block[]>(() => parseBlocks(value).blocks);
	const [parseError, setParseError] = useState<string>(() => parseBlocks(value).error);
	const [editingIndex, setEditingIndex] = useState<number | null>(null);
	const [insertAt, setInsertAt] = useState<number | null>(null);
	const [showJson, setShowJson] = useState(false);
	const [jsonDraft, setJsonDraft] = useState<string>(value);
	const skipSyncRef = useRef(false);

	// Sync from parent when `value` changes externally (ignore our own emissions)
	useEffect(() => {
		if (skipSyncRef.current) {
			skipSyncRef.current = false;
			return;
		}
		if (value === serialize(blocks)) return;
		const { blocks: parsed, error } = parseBlocks(value);
		setParseError(error);
		if (!error) setBlocks(parsed);
		setJsonDraft(value);
	}, [value]);

	function commit(next: Block[]) {
		skipSyncRef.current = true;
		setBlocks(next);
		const text = serialize(next);
		setJsonDraft(text);
		setParseError("");
		onChange(text, next);
	}

	function insert(type: BlockType, at: number) {
		const spec = BLOCK_TYPES.find((t) => t.type === type);
		if (!spec) return;
		const next = [...blocks];
		next.splice(at, 0, spec.create());
		commit(next);
		setInsertAt(null);
		setEditingIndex(at);
	}

	function updateBlock(index: number, b: Block) {
		const next = blocks.map((x, i) => (i === index ? b : x));
		commit(next);
	}

	function move(index: number, dir: -1 | 1) {
		const target = index + dir;
		if (target < 0 || target >= blocks.length) return;
		const next = [...blocks];
		[next[index], next[target]] = [next[target], next[index]];
		commit(next);
		if (editingIndex === index) setEditingIndex(target);
	}

	function remove(index: number) {
		commit(blocks.filter((_, i) => i !== index));
		if (editingIndex === index) setEditingIndex(null);
	}

	function applyJsonDraft() {
		const { blocks: parsed, error } = parseBlocks(jsonDraft);
		setParseError(error);
		if (!error) commit(parsed);
	}

	return (
		<div className="flex flex-col gap-2">
			<div className="flex items-center justify-between">
				<span className="font-medium">Contenido</span>
				<button
					type="button"
					onClick={() => setShowJson((s) => !s)}
					className="text-muted text-xs underline underline-offset-2 hover:no-underline"
				>
					{showJson ? "Ocultar JSON" : "Editar JSON"}
				</button>
			</div>

			<div className="rounded-xxl border p-4 flex flex-col">
				{blocks.length === 0 ? (
					<EmptyState onInsert={(type) => insert(type, 0)} />
				) : (
					<>
						<InsertSlot
							open={insertAt === 0}
							onOpen={() => setInsertAt(0)}
							onClose={() => setInsertAt(null)}
							onInsert={(type) => insert(type, 0)}
						/>
						{blocks.map((block, index) => (
							<div key={"block-" + index}>
								<BlockRow
									block={block}
									isEditing={editingIndex === index}
									isFirst={index === 0}
									isLast={index === blocks.length - 1}
									onEdit={() => setEditingIndex(editingIndex === index ? null : index)}
									onChange={(b) => updateBlock(index, b)}
									onMoveUp={() => move(index, -1)}
									onMoveDown={() => move(index, 1)}
									onDelete={() => remove(index)}
								/>
								<InsertSlot
									open={insertAt === index + 1}
									onOpen={() => setInsertAt(index + 1)}
									onClose={() => setInsertAt(null)}
									onInsert={(type) => insert(type, index + 1)}
								/>
							</div>
						))}
					</>
				)}
			</div>

			{showJson && (
				<div className="flex flex-col gap-2">
					<textarea
						value={jsonDraft}
						onChange={(e) => setJsonDraft(e.target.value)}
						rows={10}
						className="w-full p-2 rounded-xxl border border-alt bg-surface font-mono text-xs"
						placeholder='[{ "type": "heading", "level": 2, "text": "Título" }]'
					/>
					<div className="flex items-center gap-2">
						<button
							type="button"
							onClick={applyJsonDraft}
							className="px-3 py-1 rounded-xxl border border-alt bg-surface text-sm hover:opacity-80"
						>
							Aplicar JSON
						</button>
						{parseError && <span className="text-tdanger text-xs">JSON inválido: {parseError}</span>}
					</div>
				</div>
			)}
		</div>
	);
}

function EmptyState({ onInsert }: { readonly onInsert: (type: BlockType) => void }) {
	const [open, setOpen] = useState(false);
	return (
		<div className="flex flex-col items-center justify-center py-12 gap-3 relative">
			<p className="text-muted text-sm">El artículo está vacío</p>
			<button
				type="button"
				onClick={() => setOpen((o) => !o)}
				aria-label="Agregar primer bloque"
				className="w-14 h-14 rounded-full border border-alt bg-surface text-2xl flex items-center justify-center hover:bg-alt transition-colors shadow-sm"
			>
				+
			</button>
			{open && (
				<div className="absolute top-full mt-2 z-10">
					<TypeMenu
						onPick={(t) => {
							onInsert(t);
							setOpen(false);
						}}
						onClose={() => setOpen(false)}
					/>
				</div>
			)}
		</div>
	);
}

interface InsertSlotProps {
	readonly open: boolean;
	readonly onOpen: () => void;
	readonly onClose: () => void;
	readonly onInsert: (type: BlockType) => void;
}

function InsertSlot({ open, onOpen, onClose, onInsert }: InsertSlotProps) {
	return (
		<div className="relative group h-2 my-1">
			<button
				type="button"
				onClick={onOpen}
				aria-label="Insertar bloque aquí"
				className={`absolute left-1/2 -translate-x-1/2 -translate-y-1/2 top-1/2 w-6 h-6 rounded-full border border-alt bg-surface text-sm flex items-center justify-center transition-opacity shadow-sm ${
					open ? "opacity-100" : "opacity-0 group-hover:opacity-100 focus:opacity-100"
				}`}
			>
				+
			</button>
			{open && (
				<div className="absolute left-1/2 -translate-x-1/2 top-full mt-2 z-10">
					<TypeMenu
						onPick={(t) => {
							onInsert(t);
							onClose();
						}}
						onClose={onClose}
					/>
				</div>
			)}
		</div>
	);
}

function TypeMenu({ onPick, onClose }: { readonly onPick: (type: BlockType) => void; readonly onClose: () => void }) {
	const ref = useRef<HTMLDivElement>(null);
	useEffect(() => {
		function onDocClick(ev: MouseEvent) {
			if (!(ev.target instanceof Node)) return;
			if (!ref.current?.contains(ev.target)) onClose();
		}
		function onKey(ev: KeyboardEvent) {
			if (ev.key === "Escape") onClose();
		}
		document.addEventListener("mousedown", onDocClick);
		document.addEventListener("keydown", onKey);
		return () => {
			document.removeEventListener("mousedown", onDocClick);
			document.removeEventListener("keydown", onKey);
		};
	}, [onClose]);

	return (
		<div ref={ref} className="rounded-xxl border border-alt bg-surface shadow-lg p-2 grid grid-cols-2 gap-1 min-w-[18rem]" role="menu">
			{BLOCK_TYPES.map((t) => (
				<button
					key={t.type}
					type="button"
					onClick={() => onPick(t.type)}
					className="flex items-center gap-2 px-3 py-2 rounded-xxl text-left text-sm hover:bg-alt transition-colors"
					role="menuitem"
				>
					<span className="inline-flex w-7 h-7 items-center justify-center rounded-md border border-alt font-mono text-xs">
						{t.icon}
					</span>
					<span>{t.label}</span>
				</button>
			))}
		</div>
	);
}

interface BlockRowProps {
	readonly block: Block;
	readonly isEditing: boolean;
	readonly isFirst: boolean;
	readonly isLast: boolean;
	readonly onEdit: () => void;
	readonly onChange: (b: Block) => void;
	readonly onMoveUp: () => void;
	readonly onMoveDown: () => void;
	readonly onDelete: () => void;
}

function BlockRow({ block, isEditing, isFirst, isLast, onEdit, onChange, onMoveUp, onMoveDown, onDelete }: BlockRowProps) {
	return (
		<div className={`group relative rounded-xxl ${isEditing ? "ring-1 ring-alt bg-alt/20" : "hover:bg-alt/10"}`}>
			<div className="absolute right-2 top-2 z-1 flex items-center gap-1 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
				<IconBtn label="Mover arriba" disabled={isFirst} onClick={onMoveUp}>
					↑
				</IconBtn>
				<IconBtn label="Mover abajo" disabled={isLast} onClick={onMoveDown}>
					↓
				</IconBtn>
				<IconBtn label={isEditing ? "Cerrar edición" : "Editar bloque"} onClick={onEdit}>
					{isEditing ? "✕" : "✎"}
				</IconBtn>
				<IconBtn label="Eliminar bloque" onClick={onDelete} danger>
					🗑
				</IconBtn>
			</div>

			<button type="button" onClick={onEdit} className="w-full text-left p-2 cursor-pointer" aria-label="Editar bloque">
				<adc-blocks-renderer blocks={[block]} />
			</button>

			{isEditing && (
				<div className="border-t border-alt p-3 bg-surface rounded-b-xxl">
					<BlockFields block={block} onChange={onChange} />
				</div>
			)}
		</div>
	);
}

interface IconBtnProps {
	readonly label: string;
	readonly onClick: () => void;
	readonly disabled?: boolean;
	readonly danger?: boolean;
	readonly children: React.ReactNode;
}

function IconBtn({ label, onClick, disabled, danger, children }: IconBtnProps) {
	return (
		<button
			type="button"
			onClick={onClick}
			disabled={disabled}
			aria-label={label}
			title={label}
			className={`w-7 h-7 rounded-md border border-alt bg-surface text-sm flex items-center justify-center transition-opacity hover:bg-alt disabled:opacity-30 ${
				danger ? "text-tdanger" : ""
			}`}
		>
			{children}
		</button>
	);
}
