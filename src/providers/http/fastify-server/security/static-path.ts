import * as path from "node:path";
import { isInsideBase } from "@common/utils/path-containment.ts";

function decodeRequestPath(requestPath: string): string | null {
	try {
		return decodeURIComponent(requestPath);
	} catch {
		return null;
	}
}

export function resolveSafeStaticPath(baseDir: string, requestPath: string): string | null {
	if (!baseDir || requestPath.includes("\0")) return null;

	const decodedPath = decodeRequestPath(requestPath);
	if (!decodedPath || decodedPath.includes("\0")) return null;

	const normalizedPath = decodedPath.startsWith("/") ? `.${decodedPath}` : decodedPath;
	const resolvedPath = path.resolve(baseDir, normalizedPath);
	return isInsideBase(baseDir, resolvedPath) ? resolvedPath : null;
}

export function isSafeStaticPath(baseDir: string, filePath: string): boolean {
	return Boolean(baseDir) && isInsideBase(baseDir, filePath);
}
