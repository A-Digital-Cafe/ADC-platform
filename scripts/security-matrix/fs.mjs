import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

const ROOT = process.cwd();

export function toRepoPath(filePath) {
	return relative(ROOT, filePath).replaceAll("\\", "/");
}

export function readText(filePath) {
	return readFileSync(filePath, "utf8");
}

export function writeText(filePath, content) {
	mkdirSync(dirname(filePath), { recursive: true });
	writeFileSync(filePath, content.endsWith("\n") ? content : `${content}\n`);
}

export function walk(dir, predicate, out = []) {
	if (!existsSync(dir)) return out;
	for (const name of readdirSync(dir)) {
		const filePath = join(dir, name);
		const stat = statSync(filePath);
		if (stat.isDirectory()) walk(filePath, predicate, out);
		else if (predicate(filePath)) out.push(filePath);
	}
	return out;
}

export function rootPath(...parts) {
	return resolve(ROOT, ...parts);
}
