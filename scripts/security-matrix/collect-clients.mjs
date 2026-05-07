import ts from "typescript";
import { rootPath, toRepoPath, walk } from "./fs.mjs";
import { canonRoute, evalNode, lineOf, routePathFromNode, sourceFile, text } from "./ast-utils.mjs";

const HTTP_METHODS = new Set(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD"]);

function collectApiFactories(source) {
	const factories = new Map();
	function visit(node) {
		if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer && ts.isCallExpression(node.initializer)) {
			if (text(node.initializer.expression, source) === "createAdcApi") factories.set(node.name.text, evalNode(node.initializer.arguments[0], source) ?? {});
		}
		ts.forEachChild(node, visit);
	}
	visit(source);
	return factories;
}

function collectApiCalls(filePath, source, factories) {
	const calls = [];
	function visit(node) {
		if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
			const objectName = text(node.expression.expression, source);
			const method = node.expression.name.text.toUpperCase();
			if (factories.has(objectName) && HTTP_METHODS.has(method)) {
				const config = factories.get(objectName);
				const url = `${config.basePath ?? ""}${routePathFromNode(node.arguments[0], source)}`;
				const optionsText = text(node.arguments[1], source);
				calls.push({
					method,
					url,
					key: `${method} ${canonRoute(url)}`,
					file: toRepoPath(filePath),
					line: lineOf(source, node),
					hasIdempotency: /\bidempotency(Key|Data)\s*:/.test(optionsText),
				});
			}
		}
		ts.forEachChild(node, visit);
	}
	visit(source);
	return calls;
}

function collectDirectFetches() {
	const files = walk(rootPath("src/apps/public"), (file) => file.endsWith(".ts") || file.endsWith(".tsx"));
	const fetches = [];
	for (const file of files) {
		if (file.includes("/dist/") || file.endsWith("components.d.ts")) continue;
		const source = sourceFile(file);
		function visit(node) {
			if (ts.isCallExpression(node) && text(node.expression, source) === "fetch") fetches.push({ file: toRepoPath(file), line: lineOf(source, node), call: text(node, source).replaceAll(/\s+/g, " ").slice(0, 180) });
			ts.forEachChild(node, visit);
		}
		visit(source);
	}
	return fetches;
}

export function collectClients() {
	const apiFiles = walk(rootPath("src/apps/public"), (file) => file.endsWith("-api.ts") && file.includes("/src/utils/"));
	const calls = apiFiles.flatMap((file) => {
		const source = sourceFile(file);
		return collectApiCalls(file, source, collectApiFactories(source));
	});
	return { apiFiles: apiFiles.map(toRepoPath).sort(), calls, directFetches: collectDirectFetches() };
}
