import type { Comment } from "@common/types/comments/Comment.js";

export type CommentTreeNode = Comment & { children: CommentTreeNode[] };

/**
 * Construye un árbol de comentarios desde una lista plana basada en parentId.
 * Los nodos huérfanos (parentId desconocido) se promueven a raíz.
 */
export function buildCommentsTree(flat: Comment[]): CommentTreeNode[] {
	const map = new Map<string, CommentTreeNode>();
	for (const c of flat) map.set(c.id, { ...c, children: [] });
	const roots: CommentTreeNode[] = [];
	for (const node of map.values()) {
		if (node.parentId && map.has(node.parentId)) {
			map.get(node.parentId)!.children.push(node);
		} else {
			roots.push(node);
		}
	}
	return roots;
}
