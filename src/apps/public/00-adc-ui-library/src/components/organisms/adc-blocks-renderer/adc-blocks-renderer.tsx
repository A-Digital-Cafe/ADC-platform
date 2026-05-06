import { Component, Prop, h, Event, EventEmitter } from "@stencil/core";

type Align = "left" | "center" | "right";
type AttachmentKind = "image" | "file";

export interface Block {
	type: "heading" | "paragraph" | "list" | "code" | "callout" | "quote" | "table" | "divider" | "attachment";
	level?: number;
	id?: string;
	align?: Align;
	text?: string;
	marks?: Array<"bold" | "italic" | "code">;
	ordered?: boolean;
	items?: string[];
	start?: number;
	ariaLabel?: string;
	language?: string;
	content?: string;
	tone?: "info" | "warning" | "success" | "error";
	role?: "note" | "status" | "alert";
	url?: string;
	rel?: string[];
	header?: string[];
	rows?: string[][];
	columnAlign?: Array<Align>;
	caption?: string;
	rowHeaders?: boolean;
	// attachment-specific
	kind?: AttachmentKind;
	attachmentId?: string;
	fileName?: string;
	mimeType?: string;
	size?: number;
	alt?: string;
}

/**
 * Mapa opcional: attachmentId -> URL de descarga. Si no se provee, los bloques
 * de tipo `attachment` se renderizan como placeholder.
 */
export type AttachmentUrlMap = Record<string, string>;

@Component({
	tag: "adc-blocks-renderer",
	shadow: false,
})
export class AdcBlocksRenderer {
	@Prop() blocks: Block[] = [];
	/** Map opcional `attachmentId -> url` para resolver bloques de tipo `attachment`. */
	@Prop() attachmentUrls: AttachmentUrlMap = {};

	/** Se emite cuando el usuario solicita descargar un attachment cuyo URL no está resuelto. */
	@Event() adcAttachmentRequest!: EventEmitter<string>;

	private getAlignClass(align?: Align): string {
		if (align === "center") return "text-center";
		if (align === "right") return "text-right";
		return "";
	}

	private getMarksClass(marks?: Array<"bold" | "italic" | "code">): string {
		const classes: string[] = [];
		if (marks?.includes("bold")) classes.push("font-bold");
		if (marks?.includes("italic")) classes.push("italic");
		return classes.join(" ");
	}

	private renderBlock(block: Block, index: number) {
		switch (block.type) {
			case "heading":
				return this.renderHeading(block, index);
			case "paragraph":
				return this.renderParagraph(block, index);
			case "list":
				return (
					<adc-list-block
						key={index}
						ordered={block.ordered}
						items={block.items || []}
						start={block.start}
						ariaLabel={block.ariaLabel}
					></adc-list-block>
				);
			case "code":
				return (
					<adc-code-block
						key={index}
						language={block.language}
						content={block.content || ""}
						ariaLabel={block.ariaLabel}
					></adc-code-block>
				);
			case "callout":
				return (
					<adc-callout key={index} tone={block.tone} role={block.role}>
						<adc-inline-tokens tokens={[]} fallback={block.text || ""}></adc-inline-tokens>
					</adc-callout>
				);
			case "quote":
				return (
					<adc-quote key={index}>
						<adc-inline-tokens tokens={[]} fallback={block.text || ""}></adc-inline-tokens>
						{block.url && (
							<cite class="not-italic block mt-2 text-sm text-text opacity-80">
								<a
									href={block.url}
									target="_blank"
									rel={(block.rel || ["noopener", "noreferrer"]).join(" ")}
									aria-label={block.text}
									class="underline underline-offset-2 hover:no-underline"
								>
									Fuente
								</a>
							</cite>
						)}
					</adc-quote>
				);
			case "table":
				return (
					<adc-table-block
						key={index}
						header={block.header || []}
						rows={block.rows || []}
						columnAlign={block.columnAlign}
						caption={block.caption}
						rowHeaders={block.rowHeaders}
					></adc-table-block>
				);
			case "divider":
				return <adc-divider key={index}></adc-divider>;
			case "attachment":
				return this.renderAttachment(block, index);
			default:
				return null;
		}
	}

	private formatBytes(size?: number): string {
		if (!Number.isFinite(size)) return "";
		const n = size as number;
		if (n < 1024) return `${n} B`;
		if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
		if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
		return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
	}

	private renderAttachment(block: Block, index: number) {
		const id = block.attachmentId;
		if (!id) return null;
		const url = this.attachmentUrls[id];
		const alignClass = this.getAlignClass(block.align);
		if (block.kind === "image") {
			const fallback = (
				<button
					type="button"
					class="text-link underline"
					onClick={() => this.adcAttachmentRequest.emit(id)}
					aria-label={block.alt || block.fileName || "Cargar imagen"}
				>
					{block.alt || block.fileName || "Cargar imagen"}
				</button>
			);
			return (
				<figure key={index} class={`my-2 ${alignClass}`.trim()}>
					{url ? (
						<img src={url} alt={block.alt || block.fileName || ""} class="max-w-full h-auto rounded-xxl" loading="lazy" />
					) : (
						fallback
					)}
					{block.caption && <figcaption class="text-sm text-muted mt-1">{block.caption}</figcaption>}
				</figure>
			);
		}
		const sizeStr = this.formatBytes(block.size);
		const label = `${block.fileName || "Archivo"}${sizeStr ? ` (${sizeStr})` : ""}`;
		return (
			<div key={index} class={`my-2 ${alignClass}`.trim()}>
				{url ? (
					<a href={url} class="inline-flex items-center gap-2 text-link underline" download={block.fileName}>
						📎 {label}
					</a>
				) : (
					<button
						type="button"
						class="inline-flex items-center gap-2 text-link underline"
						onClick={() => this.adcAttachmentRequest.emit(id)}
					>
						📎 {label}
					</button>
				)}
				{block.caption && <p class="text-sm text-muted mt-1">{block.caption}</p>}
			</div>
		);
	}

	private renderHeading(block: Block, index: number) {
		const alignClass = this.getAlignClass(block.align);
		const level = block.level || 2;
		const Tag = `h${level}` as "h2" | "h3" | "h4" | "h5" | "h6";

		return (
			<Tag key={index} id={block.id} class={alignClass}>
				{block.text}
			</Tag>
		);
	}

	private renderParagraph(block: Block, index: number) {
		const classes = `${this.getAlignClass(block.align)} ${this.getMarksClass(block.marks)} pl-4 pr-16 whitespace-pre-line`;

		if (block.marks?.includes("code")) {
			return (
				<adc-text key={index} class={classes}>
					<code>{block.text}</code>
				</adc-text>
			);
		}

		return (
			<adc-text key={index} class={classes}>
				<adc-inline-tokens tokens={[]} fallback={block.text || ""}></adc-inline-tokens>
			</adc-text>
		);
	}

	render() {
		void h;
		return <div>{this.blocks.map((block, index) => this.renderBlock(block, index))}</div>;
	}
}
