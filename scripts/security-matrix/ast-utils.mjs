import ts from "typescript";
import { readText } from "./fs.mjs";

export function sourceFile(filePath) {
	return ts.createSourceFile(filePath, readText(filePath), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
}

export function text(node, source) {
	return node?.getText(source) ?? "";
}

export function lineOf(source, node) {
	return source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
}

export function decoratorsOf(node) {
	return ts.canHaveDecorators(node) ? ts.getDecorators(node) ?? [] : [];
}

export function evalNode(node, source) {
	if (!node) return undefined;
	if (ts.isStringLiteralLike(node)) return node.text;
	if (node.kind === ts.SyntaxKind.TrueKeyword) return true;
	if (node.kind === ts.SyntaxKind.FalseKeyword) return false;
	if (ts.isNumericLiteral(node)) return Number(node.text);
	if (ts.isArrayLiteralExpression(node)) return node.elements.map((item) => evalNode(item, source) ?? text(item, source));
	if (ts.isObjectLiteralExpression(node)) return objectLiteralToRecord(node, source);
	return text(node, source);
}

function objectLiteralToRecord(node, source) {
	const record = {};
	for (const property of node.properties) {
		if (!ts.isPropertyAssignment(property)) continue;
		const name = property.name;
		const key = ts.isIdentifier(name) || ts.isStringLiteralLike(name) ? name.text : text(name, source);
		record[key] = evalNode(property.initializer, source) ?? text(property.initializer, source);
	}
	return record;
}

export function routePathFromNode(node, source) {
	if (!node) return "";
	if (ts.isStringLiteralLike(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
	if (!ts.isTemplateExpression(node)) return text(node, source);
	let out = node.head.text;
	for (const span of node.templateSpans) out += `:x${span.literal.text}`;
	return out;
}

export function canonRoute(url) {
	return url.replaceAll(/:[^/]+/g, ":x").replaceAll(/\/+/g, "/");
}
