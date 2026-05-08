import type { Block, CalloutRole, CalloutTone, TextAlign, TextMark } from "@ui-library/utils/connect-rpc";

export type HeadingBlock = Extract<Block, { type: "heading" }>;
export type ParagraphBlock = Extract<Block, { type: "paragraph" }>;
export type ListBlock = Extract<Block, { type: "list" }>;
export type CodeBlock = Extract<Block, { type: "code" }>;
export type CalloutBlock = Extract<Block, { type: "callout" }>;
export type QuoteBlock = Extract<Block, { type: "quote" }>;
export type TableBlock = Extract<Block, { type: "table" }>;

export const inputCls = "w-full p-2 rounded-xxl border border-alt bg-surface";
export const labelCls = "flex flex-col gap-1 text-sm";
export const headingLevels: HeadingBlock["level"][] = [2, 3, 4, 5, 6];
export const textAligns: TextAlign[] = ["left", "center", "right"];
export const textMarks: TextMark[] = ["bold", "italic", "code"];
export const calloutTones: CalloutTone[] = ["info", "warning", "success", "error"];
export const calloutRoles: CalloutRole[] = ["note", "status", "alert"];

export function patchBlock<T extends Block>(block: T, patch: Partial<Omit<T, "type">>): T {
	return { ...block, ...patch };
}

export function alignLabel(align: TextAlign): string {
	return align === "left" ? "Izquierda" : align === "center" ? "Centro" : "Derecha";
}

export function titleCase(value: string): string {
	return value[0].toUpperCase() + value.slice(1);
}
