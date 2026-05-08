import * as path from "node:path";

function decodeRequestPath(requestPath: string): string | null {
	try {
		return decodeURIComponent(requestPath);
	} catch {
		return null;
	}
}

function isInsideBase(baseDir: string, filePath: string): boolean {
	const resolvedBase = path.resolve(baseDir);
	const resolvedFile = path.resolve(filePath);
	return resolvedFile === resolvedBase || resolvedFile.startsWith(`${resolvedBase}${path.sep}`);
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
