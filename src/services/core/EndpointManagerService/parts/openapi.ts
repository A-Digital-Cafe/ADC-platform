import type { RegisteredEndpoint } from "../types.js";

/**
 * Generación del documento OpenAPI 3.0 a partir del EndpointRegistry (U-01).
 * Los schemas TypeBox declarados en `options.schema` son JSON Schema estándar,
 * por lo que se embeben directamente en el spec.
 */

interface OpenApiOperation {
	summary: string;
	tags: string[];
	security?: Array<Record<string, string[]>>;
	parameters?: Array<Record<string, unknown>>;
	requestBody?: Record<string, unknown>;
	responses: Record<string, unknown>;
}

function toOpenApiPath(url: string): string {
	// Fastify-style ":param" → OpenAPI "{param}"
	return url.replaceAll(/:(\w+)/g, "{$1}");
}

function pathParams(url: string): string[] {
	return [...url.matchAll(/:(\w+)/g)].map((m) => m[1]);
}

function sanitizeSchema(schema: unknown): Record<string, unknown> {
	// structuredClone omite las propiedades con clave Symbol (artefactos internos
	// de TypeBox como TypeBox.Kind), dejando JSON Schema puro para el documento.
	return structuredClone(schema ?? { type: "object" }) as Record<string, unknown>;
}

function buildOperation(endpoint: RegisteredEndpoint): OpenApiOperation {
	const op: OpenApiOperation = {
		summary: `${endpoint.ownerName}.${endpoint.methodName}`,
		tags: [endpoint.ownerName.split("::")[0]],
		responses: {
			"200": { description: "OK" },
			"400": { description: "Entrada inválida" },
			"401": { description: "No autenticado" },
			"403": { description: "Sin permisos" },
		},
	};

	if (endpoint.permissions.length > 0) {
		op.security = [{ cookieAuth: [] }, { bearerAuth: [] }];
		op.responses["403"] = {
			description: `Requiere: ${endpoint.permissions.join(" | ")}`,
		};
	}

	const params: Array<Record<string, unknown>> = pathParams(endpoint.url).map((name) => ({
		name,
		in: "path",
		required: true,
		schema: { type: "string" },
	}));

	const querySchema = endpoint.options?.schema?.querystring;
	if (querySchema && typeof querySchema === "object" && "properties" in querySchema) {
		const required = new Set((querySchema.required as string[]) ?? []);
		for (const [name, schema] of Object.entries(querySchema.properties as Record<string, unknown>)) {
			params.push({ name, in: "query", required: required.has(name), schema: sanitizeSchema(schema) });
		}
	}
	if (params.length > 0) op.parameters = params;

	const bodySchema = endpoint.options?.schema?.body;
	if (bodySchema && endpoint.method !== "GET" && endpoint.method !== "HEAD") {
		op.requestBody = {
			required: true,
			content: { "application/json": { schema: sanitizeSchema(bodySchema) } },
		};
	}

	return op;
}

/** Construye el documento OpenAPI completo desde los endpoints registrados. */
export function buildOpenApiDocument(endpoints: RegisteredEndpoint[]): Record<string, unknown> {
	const paths: Record<string, Record<string, OpenApiOperation>> = {};

	for (const endpoint of endpoints) {
		const path = toOpenApiPath(endpoint.url);
		paths[path] ??= {};
		paths[path][endpoint.method.toLowerCase()] = buildOperation(endpoint);
	}

	return {
		openapi: "3.0.3",
		info: {
			title: "ADC Platform API",
			description: "Documento generado automáticamente desde los endpoints @RegisterEndpoint.",
			version: "1.0.0",
		},
		components: {
			securitySchemes: {
				cookieAuth: { type: "apiKey", in: "cookie", name: "access_token" },
				bearerAuth: { type: "http", scheme: "bearer" },
			},
		},
		paths,
	};
}
