import { RegisterEndpoint, type EndpointCtx } from "../../../core/EndpointManagerService/index.js";
import { ProjectManagerError } from "@common/types/custom-errors/ProjectManagerError.ts";
import type { CreateOrganizationRequestInput, OrganizationRequestSocialNetwork } from "@common/types/project-manager/OrganizationRequest.ts";
import type ProjectManagerService from "../index.js";

const THREE_DAYS_MS = 3 * 24 * 60 * 60 * 1000;
const ORG_REQUEST_RATE_LIMIT = { max: 1, timeWindow: THREE_DAYS_MS };
const MAX_NAME_LENGTH = 120;
const MAX_DESCRIPTION_LENGTH = 2000;
const MAX_URL_LENGTH = 2048;
const MAX_SOCIAL_NETWORKS = 10;

function readTrimmedString(value: unknown): string | undefined {
	return typeof value === "string" ? value.trim() : undefined;
}

function requireTrimmedString(value: unknown, field: string): string {
	const trimmed = readTrimmedString(value);
	if (!trimmed) throw new ProjectManagerError(400, "MISSING_FIELDS", `\`${field}\` es requerido`);
	return trimmed;
}

function optionalBoundedString(value: unknown, field: string, maxLength: number): string | undefined {
	const trimmed = readTrimmedString(value);
	if (!trimmed) return undefined;
	if (trimmed.length > maxLength) throw new ProjectManagerError(400, "INVALID_FIELD", `\`${field}\` es demasiado largo`);
	return trimmed;
}

function normalizeEmail(value: unknown): string {
	const email = requireTrimmedString(value, "email").toLowerCase();
	if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
		throw new ProjectManagerError(400, "INVALID_FIELD", "`email` no es válido");
	}
	return email;
}

function normalizeUrl(value: unknown, field: string): string | undefined {
	const url = optionalBoundedString(value, field, MAX_URL_LENGTH);
	if (!url) return undefined;
	try {
		const parsed = new URL(url);
		if (!["http:", "https:"].includes(parsed.protocol)) throw new Error("Invalid protocol");
		return parsed.toString();
	} catch {
		throw new ProjectManagerError(400, "INVALID_FIELD", `\`${field}\` no es una URL válida`);
	}
}

function normalizeSocialNetworks(value: unknown): OrganizationRequestSocialNetwork[] | undefined {
	if (value === undefined || value === null) return undefined;
	if (!Array.isArray(value)) throw new ProjectManagerError(400, "INVALID_FIELD", "`socialNetworks` debe ser un array");
	if (value.length > MAX_SOCIAL_NETWORKS) throw new ProjectManagerError(400, "INVALID_FIELD", "Demasiadas redes sociales");

	const items = value.map((item, index) => {
		if (!item || typeof item !== "object") {
			throw new ProjectManagerError(400, "INVALID_FIELD", `Red social ${index + 1} inválida`);
		}
		const record = item as Record<string, unknown>;
		const platform = requireTrimmedString(record.platform, `socialNetworks[${index}].platform`);
		if (platform.length > 80) throw new ProjectManagerError(400, "INVALID_FIELD", "Nombre de red social demasiado largo");
		const url = normalizeUrl(record.url, `socialNetworks[${index}].url`);
		if (!url) throw new ProjectManagerError(400, "MISSING_FIELDS", `\`socialNetworks[${index}].url\` es requerido`);
		return { platform, url };
	});

	return items.length ? items : undefined;
}

function normalizeInput(data: unknown): CreateOrganizationRequestInput {
	const record = (data ?? {}) as Record<string, unknown>;
	const name = requireTrimmedString(record.name, "name");
	if (name.length < 3) throw new ProjectManagerError(400, "INVALID_FIELD", "`name` debe tener al menos 3 caracteres");
	if (name.length > MAX_NAME_LENGTH) throw new ProjectManagerError(400, "INVALID_FIELD", "`name` es demasiado largo");

	return {
		name,
		email: normalizeEmail(record.email),
		description: optionalBoundedString(record.description, "description", MAX_DESCRIPTION_LENGTH),
		url: normalizeUrl(record.url, "url"),
		socialNetworks: normalizeSocialNetworks(record.socialNetworks),
	};
}

export class OrganizationRequestEndpoints {
	private static service: ProjectManagerService;
	private static kernelKey: symbol;

	static init(service: ProjectManagerService, kernelKey: symbol): void {
		OrganizationRequestEndpoints.service ??= service;
		OrganizationRequestEndpoints.kernelKey ??= kernelKey;
	}

	@RegisterEndpoint({
		method: "POST",
		url: "/api/pm/organization-requests",
		deferAuth: true,
		options: { rateLimit: ORG_REQUEST_RATE_LIMIT },
	})
	static async create(ctx: EndpointCtx<never, CreateOrganizationRequestInput>) {
		if (!ctx.user?.id) throw new ProjectManagerError(401, "NO_TOKEN", "Debes iniciar sesión para solicitar una organización");

		const input = normalizeInput(ctx.data);
		return OrganizationRequestEndpoints.service.organizationRequests.create(OrganizationRequestEndpoints.kernelKey, input, {
			userId: ctx.user.id,
			email: ctx.user.email,
			ip: ctx.ip,
		});
	}
}
