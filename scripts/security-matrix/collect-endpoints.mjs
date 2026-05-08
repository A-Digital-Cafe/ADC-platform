import ts from "typescript";
import { rootPath, toRepoPath, walk } from "./fs.mjs";
import { canonRoute, decoratorsOf, evalNode, lineOf, sourceFile, text } from "./ast-utils.mjs";

function methodNameOf(node, source) {
	return ts.isMethodDeclaration(node) && ts.isIdentifier(node.name) ? node.name.text : "";
}

function ownerNameOf(node) {
	return node.parent && ts.isClassDeclaration(node.parent) ? node.parent.name?.text ?? "" : "";
}

function endpointAuthKind(endpoint) {
	if (endpoint.deferAuth) return "deferAuth";
	if (endpoint.permissions.length > 0) return "RBAC";
	if (/ctx\.user|ctx\.cookies|ctx\.token|NO_SESSION|UNAUTHORIZED/.test(endpoint.handlerText)) return "session/manual";
	return "public";
}

function endpointStatus(handlerText) {
	return /throw\s+new\s+\w*Error\(\s*501\b|NOT_IMPLEMENTED|Stub read-only/i.test(handlerText) ? "stub" : "active";
}

function endpointFromDecorator(expr, node, source, filePath) {
	const config = evalNode(expr.arguments[0], source) ?? {};
	const method = config.method ?? "GET";
	const url = config.url ?? "";
	const handlerText = text(node, source);
	const permissions = Array.isArray(config.permissions) ? config.permissions : [];
	const endpoint = {
		method,
		url,
		key: `${method} ${canonRoute(url)}`,
		permissions,
		deferAuth: config.deferAuth === true,
		options: config.options ?? {},
		file: toRepoPath(filePath),
		line: lineOf(source, node),
		handler: methodNameOf(node, source),
		owner: ownerNameOf(node),
		handlerText,
	};
	endpoint.auth = endpointAuthKind(endpoint);
	endpoint.status = endpointStatus(handlerText);
	return endpoint;
}

export function collectEndpoints() {
	const files = walk(rootPath("src/services"), (file) => file.endsWith(".ts") && file.includes("/endpoints/"));
	const endpoints = [];
	for (const file of files) {
		const source = sourceFile(file);
		function visit(node) {
			for (const decorator of decoratorsOf(node)) {
				const expr = decorator.expression;
				if (ts.isCallExpression(expr) && text(expr.expression, source) === "RegisterEndpoint") endpoints.push(endpointFromDecorator(expr, node, source, file));
			}
			ts.forEachChild(node, visit);
		}
		visit(source);
	}
	return endpoints.sort((left, right) => (left.url + left.method).localeCompare(right.url + right.method));
}
