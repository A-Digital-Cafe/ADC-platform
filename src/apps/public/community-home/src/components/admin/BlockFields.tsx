import type { Block } from "@ui-library/utils/connect-rpc";
import { HeadingFields, ParagraphFields } from "./block-fields/TextBlockFields";
import { ListFields } from "./block-fields/ListBlockFields";
import { CalloutFields, CodeFields, QuoteFields } from "./block-fields/ContentBlockFields";
import { TableFields } from "./block-fields/TableBlockFields";

interface Props {
	readonly block: Block;
	readonly onChange: (next: Block) => void;
}

export function BlockFields({ block, onChange }: Props) {
	switch (block.type) {
		case "heading":
			return <HeadingFields block={block} onChange={onChange} />;
		case "paragraph":
			return <ParagraphFields block={block} onChange={onChange} />;
		case "list":
			return <ListFields block={block} onChange={onChange} />;
		case "code":
			return <CodeFields block={block} onChange={onChange} />;
		case "callout":
			return <CalloutFields block={block} onChange={onChange} />;
		case "quote":
			return <QuoteFields block={block} onChange={onChange} />;
		case "table":
			return <TableFields block={block} onChange={onChange} />;
		case "divider":
			return <p className="text-muted text-sm">Este bloque no tiene propiedades configurables.</p>;
		default:
			return <p className="text-tdanger text-sm">Tipo de bloque desconocido.</p>;
	}
}
