import { Component, Prop, h, Event, EventEmitter, State, Watch } from "@stencil/core";
import type { Block } from "../../organisms/adc-blocks-renderer/adc-blocks-renderer";

export interface CommentFormSubmitDetail {
	blocks: Block[];
	attachmentIds: string[];
}

/**
 * Formulario de comentario basado en `<adc-blocks-editor>`. Soporta drafts
 * persistentes con debounce: al cambiar el contenido, espera `draftDebounceMs`
 * y emite `adcDraftChange`. La app consumidora puede persistir vía
 * `commentsApi.saveDraft`. Al montarse, si recibe `initialBlocks` los renderiza.
 */
@Component({
	tag: "adc-comment-form",
	shadow: false,
})
export class AdcCommentForm {
	@Prop() submitting: boolean = false;
	@Prop() placeholder: string = "Escribe un comentario...";
	@Prop() submitLabel: string = "Comentar";
	@Prop() initialBlocks: Block[] = [];
	@Prop() initialAttachmentIds: string[] = [];
	@Prop() draftDebounceMs: number = 800;
	@Prop() showCancel: boolean = false;
	@Prop() disabled: boolean = false;

	@State() blocks: Block[] = [];
	@State() attachmentIds: string[] = [];

	#draftTimer: ReturnType<typeof setTimeout> | null = null;

	@Event() adcSubmit!: EventEmitter<CommentFormSubmitDetail>;
	@Event() adcCancel!: EventEmitter<void>;
	@Event() adcDraftChange!: EventEmitter<{ blocks: Block[]; attachmentIds: string[] }>;
	/** El consumidor escucha este evento para abrir el selector y devolver el `attachmentId`. */
	@Event() adcRequestAttachment!: EventEmitter<{ kind: "image" | "file" }>;

	componentWillLoad() {
		this.blocks = this.initialBlocks?.length ? this.initialBlocks : [];
		this.attachmentIds = this.initialAttachmentIds || [];
	}

	@Watch("initialBlocks")
	onInitialBlocks(newVal: Block[]) {
		this.blocks = newVal || [];
	}
	@Watch("initialAttachmentIds")
	onInitialAttachmentIds(newVal: string[]) {
		this.attachmentIds = newVal || [];
	}

	disconnectedCallback() {
		if (this.#draftTimer) clearTimeout(this.#draftTimer);
	}

	#scheduleDraftEmit() {
		if (this.#draftTimer) clearTimeout(this.#draftTimer);
		this.#draftTimer = setTimeout(
			() => {
				this.adcDraftChange.emit({ blocks: this.blocks, attachmentIds: this.attachmentIds });
			},
			Math.max(0, this.draftDebounceMs)
		);
	}

	#hasContent(): boolean {
		const hasText = this.blocks.some((b) => b.type === "paragraph" && (b.text || "").trim().length > 0);
		const hasAtt = this.attachmentIds.length > 0 || this.blocks.some((b) => b.type === "attachment");
		return hasText || hasAtt;
	}

	private readonly handleBlocksChange = (ev: CustomEvent<Block[]>) => {
		ev.stopPropagation();
		this.blocks = ev.detail || [];
		this.#scheduleDraftEmit();
	};

	private readonly handleRequestAttachment = (ev: CustomEvent<{ kind: "image" | "file" }>) => {
		ev.stopPropagation();
		this.adcRequestAttachment.emit(ev.detail);
	};

	private readonly handleSubmit = (ev: Event) => {
		ev.preventDefault();
		if (this.submitting || this.disabled || !this.#hasContent()) return;
		this.adcSubmit.emit({ blocks: this.blocks, attachmentIds: this.attachmentIds });
	};

	private readonly handleCancel = () => {
		this.adcCancel.emit();
	};

	render() {
		const disabled = this.submitting || this.disabled || !this.#hasContent();
		return (
			<form onSubmit={this.handleSubmit} class="flex flex-col gap-2 bg-surface rounded-xxl p-2 shadow-cozy">
				<adc-blocks-editor
					blocks={this.blocks}
					placeholder={this.placeholder}
					disabled={this.disabled}
					onAdcBlocksChange={this.handleBlocksChange}
					onAdcRequestAttachment={this.handleRequestAttachment}
				/>
				<div class="flex items-center justify-end gap-2">
					{this.showCancel && (
						<adc-button type="button" variant="accent" onClick={this.handleCancel} disabled={this.submitting} label="Cancelar" />
					)}
					<adc-button type="submit" disabled={disabled} label={this.submitting ? "Publicando..." : this.submitLabel} />
				</div>
			</form>
		);
	}
}
