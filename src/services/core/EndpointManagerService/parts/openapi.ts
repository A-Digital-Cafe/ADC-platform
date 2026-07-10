import type { RegisteredEndpoint } from "../types.js";
import { describePermission } from "@common/types/Permissions.js";
import { trimChar } from "@common/utils/strings.js";

/**
 * Generación del documento OpenAPI 3.0 a partir del EndpointRegistry (U-01).
 * Los schemas TypeBox declarados en `options.schema` son JSON Schema estándar,
 * por lo que se embeben directamente en el spec.
 */

interface OpenApiOperation {
	summary: string;
	description?: string;
	operationId: string;
	tags: string[];
	deprecated?: boolean;
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

/**
 * Sub-tag del endpoint para Swagger UI: `options.tag` si está declarado
 * (convención `"Servicio/Recurso"`), o el nombre del servicio por defecto.
 */
function resolveTag(endpoint: RegisteredEndpoint): string {
	const declared = endpoint.options?.tag;
	if (typeof declared === "string" && declared.length > 0) return declared;
	return endpoint.ownerName.split("::")[0];
}

/** operationId único y estable derivado de método + ruta. */
function buildOperationId(endpoint: RegisteredEndpoint): string {
	return trimChar(`${endpoint.method}_${endpoint.url}`.replaceAll(/[^A-Za-z0-9]+/g, "_"), "_");
}

const DEFAULT_RESPONSES: Record<string, Record<string, unknown>> = {
	"200": { description: "OK" },
	"400": { description: "Entrada inválida" },
	"401": { description: "No autenticado" },
	"403": { description: "Sin permisos" },
};

function buildResponses(endpoint: RegisteredEndpoint): Record<string, unknown> {
	const responses: Record<string, Record<string, unknown>> = structuredClone(DEFAULT_RESPONSES);

	if (endpoint.permissions.length > 0) {
		responses["403"] = { description: `Requiere: ${endpoint.permissions.map(describePermission).join(" | ")}` };
	}

	// Schemas de respuesta declarados (solo documentación, no validación runtime).
	const declared = endpoint.options?.schema?.response;
	if (declared && typeof declared === "object") {
		for (const [status, schema] of Object.entries(declared)) {
			const existing = responses[status] ?? {};
			responses[status] = {
				description: existing.description ?? "OK",
				content: { "application/json": { schema: sanitizeSchema(schema) } },
			};
		}
	}

	return responses;
}

function buildParameters(endpoint: RegisteredEndpoint): Array<Record<string, unknown>> {
	const paramsSchema = endpoint.options?.schema?.params as { properties?: Record<string, unknown> } | undefined;
	const paramProps = paramsSchema?.properties ?? {};

	const params: Array<Record<string, unknown>> = pathParams(endpoint.url).map((name) => ({
		name,
		in: "path",
		required: true,
		// Usa el schema declarado para el path param (descripción/formato/patrón)
		// si existe; en su defecto, string simple.
		schema: paramProps[name] ? sanitizeSchema(paramProps[name]) : { type: "string" },
	}));

	const querySchema = endpoint.options?.schema?.querystring;
	if (querySchema && typeof querySchema === "object" && "properties" in querySchema) {
		const required = new Set((querySchema.required as string[]) ?? []);
		for (const [name, schema] of Object.entries(querySchema.properties as Record<string, unknown>)) {
			params.push({ name, in: "query", required: required.has(name), schema: sanitizeSchema(schema) });
		}
	}

	return params;
}

function buildOperation(endpoint: RegisteredEndpoint): OpenApiOperation {
	const op: OpenApiOperation = {
		summary: endpoint.options?.summary ?? `${endpoint.ownerName}.${endpoint.methodName}`,
		operationId: buildOperationId(endpoint),
		tags: [resolveTag(endpoint)],
		responses: buildResponses(endpoint),
	};

	const description = endpoint.options?.description;
	if (typeof description === "string" && description.length > 0) op.description = description;
	if (endpoint.options?.deprecated === true) op.deprecated = true;

	if (endpoint.permissions.length > 0) {
		op.security = [{ cookieAuth: [] }, { bearerAuth: [] }];
	}

	const params = buildParameters(endpoint);
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
	const tagNames = new Set<string>();

	for (const endpoint of endpoints) {
		const path = toOpenApiPath(endpoint.url);
		paths[path] ??= {};
		paths[path][endpoint.method.toLowerCase()] = buildOperation(endpoint);
		tagNames.add(resolveTag(endpoint));
	}

	// Tags ordenados alfabéticamente: agrupa los sub-tags de un mismo servicio
	// (ej. "IdentityManagerService/Groups" y "IdentityManagerService/Users"
	// quedan contiguos) y fija un orden estable en Swagger UI.
	const tags = [...tagNames].sort((a, b) => a.localeCompare(b)).map((name) => ({ name }));

	return {
		openapi: "3.0.3",
		info: {
			title: "ADC Platform API",
			description: "Documento generado automáticamente desde los endpoints @RegisterEndpoint.",
			version: "1.0.0",
		},
		tags,
		components: {
			securitySchemes: {
				cookieAuth: { type: "apiKey", in: "cookie", name: "access_token" },
				bearerAuth: { type: "http", scheme: "bearer" },
			},
		},
		paths,
	};
}
