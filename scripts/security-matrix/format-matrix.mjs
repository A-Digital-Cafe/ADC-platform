const MUTATIVE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

function countBy(items, selector) {
	const counts = new Map();
	for (const item of items) counts.set(selector(item), (counts.get(selector(item)) ?? 0) + 1);
	return Object.fromEntries([...counts.entries()].sort((a, b) => {
		if (typeof a[0] === "string" && typeof b[0] === "string") return a[0].localeCompare(b[0]);
		if(typeof a[0] === "number" && typeof b[0] === "number") return a[0] - b[0];
		return 0;
	}));
}

function rateLabel(endpoint) {
	return endpoint.options.rateLimit ? "custom(redis)" : "global(redis)";
}

function idempotencyLabel(endpoint) {
	if (!MUTATIVE_METHODS.has(endpoint.method)) return "n/a";
	return endpoint.options.skipIdempotency === true ? "skip" : "required";
}

function csrfLabel(endpoint) {
	if (!MUTATIVE_METHODS.has(endpoint.method)) return "n/a";
	return endpoint.options.skipCsrf === true ? "skip" : "cookie";
}

function routeRef(endpoint) {
	return `${endpoint.method} ${endpoint.url}`;
}

function matrixRow(endpoint, clientCalls) {
	const clients = clientCalls.filter((call) => call.key === endpoint.key).length;
	return `| ${routeRef(endpoint)} | ${endpoint.auth} | ${rateLabel(endpoint)} | ${idempotencyLabel(endpoint)} | ${csrfLabel(endpoint)} | ${endpoint.status} | ${clients} |`;
}

function buildFindings(endpoints, clients) {
	const endpointKeys = new Set(endpoints.map((endpoint) => endpoint.key));
	const unmatchedClients = clients.calls.filter((call) => !endpointKeys.has(call.key));
	const clientMissingIdempotency = clients.calls.filter((call) => {
		const endpoint = endpoints.find((item) => item.key === call.key);
		return endpoint && MUTATIVE_METHODS.has(call.method) && endpoint.options.skipIdempotency !== true && !call.hasIdempotency;
	});
	const stubs = endpoints.filter((endpoint) => endpoint.status === "stub");
	return { unmatchedClients, clientMissingIdempotency, stubs };
}

function directFetchTable(fetches) {
	if (fetches.length === 0) return "No direct `fetch()` calls found outside `adc-fetch` internals.";
	const itemPartStr = (item) => item.call.replaceAll("|", String.raw`\|`);
	return ["| File | Call |", "| --- | --- |", ...fetches.map((item) => `| ${item.file}:${item.line} | ${itemPartStr(item)} |`)].join("\n");
}

export function formatMatrix(endpoints, clients) {
	const findings = buildFindings(endpoints, clients);
	const stubsEndpoints = ` (${findings.stubs.map(routeRef).join(", ")})`;
	const lines = [
		"# Backend Security Matrix",
		"",
		`Scope: ${endpoints.length} real \`@RegisterEndpoint\` decorators, ${clients.apiFiles.length} public \`src/apps/public/*/src/utils/*-api.ts\` clients, ${clients.calls.length} client calls.`,
		"",
		"Legend: Auth is `RBAC`, `deferAuth`, `session/manual`, or `public`; Rate labels require Redis; Idem applies to POST/PUT/PATCH/DELETE; CSRF applies to browser cookie requests.",
		"",
		"## Findings",
		"",
		`- Unmatched public API client calls: ${findings.unmatchedClients.length}.`,
		`- Mutative public API calls missing idempotency when backend requires it: ${findings.clientMissingIdempotency.length}.`,
		`- Stub endpoints: ${findings.stubs.length}${findings.stubs.length ? stubsEndpoints : ""}.`,
		"- Rate limit labels are effective only when the Redis provider is available at runtime.",
		"",
		"## Summary",
		"",
		`- By method: ${JSON.stringify(countBy(endpoints, (endpoint) => endpoint.method))}`,
		`- By auth: ${JSON.stringify(countBy(endpoints, (endpoint) => endpoint.auth))}`,
		"",
		"## Matrix",
		"",
		"| Endpoint | Auth | Rate | Idem | CSRF | Status | Client calls |",
		"| --- | --- | --- | --- | --- | --- | --- |",
		...endpoints.map((endpoint) => matrixRow(endpoint, clients.calls)),
		"",
		"## Direct Fetches",
		"",
		directFetchTable(clients.directFetches),
		"",
	];
	return lines.join("\n");
}
