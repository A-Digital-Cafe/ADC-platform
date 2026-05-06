/**
 * Tipos centralizados para el módulo de Learning
 * Fuente única de verdad - usado por backend, frontend y modelos
 */

// ============================================================================
// Block Types (discriminated union)
// ============================================================================

export type TextAlign = "left" | "center" | "right";
export type TextMark = "bold" | "italic" | "code";
export type CalloutTone = "info" | "warning" | "success" | "error";
export type CalloutRole = "note" | "status" | "alert";
export type LinkRel = "nofollow" | "noopener" | "noreferrer" | "ugc" | "sponsored";

export type AttachmentKind = "image" | "file";

export type Block =
	| { type: "heading"; level: 2 | 3 | 4 | 5 | 6; text: string; align?: TextAlign; id?: string }
	| { type: "paragraph"; text: string; align?: TextAlign; marks?: TextMark[] }
	| { type: "list"; ordered?: boolean; items: string[]; start?: number; ariaLabel?: string }
	| { type: "code"; language: string; content: string; ariaLabel?: string }
	| { type: "callout"; tone: CalloutTone; text: string; role?: CalloutRole }
	| { type: "quote"; text: string; url?: string; rel?: LinkRel[]; ariaLabel?: string }
	| { type: "table"; header: string[]; rows: string[][]; columnAlign?: TextAlign[]; caption?: string; rowHeaders?: boolean }
	| {
			type: "attachment";
			kind: AttachmentKind;
			attachmentId: string;
			fileName: string;
			mimeType: string;
			size: number;
			alt?: string;
			caption?: string;
			align?: TextAlign;
	  }
	| { type: "divider" };

// ============================================================================
// Learning Path
// ============================================================================

export type PathItemType = "article" | "path";
export type PathItemLevel = "critico" | "importante" | "opcional";

export interface PathItem {
	slug: string;
	type: PathItemType;
	level?: PathItemLevel;
}

export interface Image {
	url: string;
	width?: number;
	height?: number;
	alt?: string;
}

export interface LearningPath {
	slug: string;
	title: string;
	description: string;
	color: string;
	banner?: Image;
	public: boolean;
	listed: boolean;
	items: PathItem[];
	createdAt?: string;
	updatedAt?: string;
}

// ============================================================================
// Article
// ============================================================================

export interface Article {
	slug: string;
	title: string;
	pathSlug?: string;
	blocks: Block[];
	videoUrl?: string;
	image?: Image;
	authorId: string;
	listed: boolean;
	description?: string;
	pathColor?: string;
	createdAt?: string;
	updatedAt?: string;
}
