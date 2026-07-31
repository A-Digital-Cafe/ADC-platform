/**
 * Tags de media-ui-library (preset adc-media) usados por componentes de esta lib
 * (adc-comments-section / adc-comment-item). Solo tipos: en runtime los custom
 * elements los define la media-ui-library, que las apps consumidoras cargan vía
 * `import "@media-ui-library"`. Si el preset no está clonado, los tags quedan
 * sin definir y los comentarios degradan sin crash.
 */
import type { Block } from "@common/ADC/types/learning.js";

declare module "@stencil/core" {
	export namespace JSX {
		interface MediaLibBlocksRendererProps {
			blocks?: Block[];
			attachmentUrls?: Record<string, string>;
			onAdcAttachmentRequest?: (event: CustomEvent<string>) => void;
			[prop: string]: any;
		}
		interface MediaLibBlocksFormProps {
			[prop: string]: any;
		}
		interface IntrinsicElements {
			"adc-blocks-renderer": MediaLibBlocksRendererProps;
			"adc-blocks-form": MediaLibBlocksFormProps;
		}
	}
}
export {};
