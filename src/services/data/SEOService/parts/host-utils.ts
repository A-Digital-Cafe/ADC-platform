import type { FastifyRequest } from "fastify";
import type { UIModuleConfig } from "../../../../interfaces/modules/IUIModule.js";

export function collectHosts(hosting?: UIModuleConfig["hosting"]): string[] {
	if (!hosting?.length) return [];
	const out: string[] = [];
	for (const cfg of hosting) {
		for (const domain of cfg.domains) {
			if (cfg.subdomains?.length) {
				for (const sub of cfg.subdomains) out.push(`${sub}.${domain}`);
			} else {
				out.push(domain);
			}
		}
	}
	return out;
}

export function buildAbsoluteOrigin(req: FastifyRequest, hostFallback: string): string {
	const forwardedProto = req.headers["x-forwarded-proto"];
	const proto = (typeof forwardedProto === "string" ? forwardedProto.split(",")[0].trim() : "") || "https";
	const headerHost = req.headers.host?.split(",")[0]?.trim();
	const host = headerHost || hostFallback.replace(/^\*\./, "");
	return `${proto}://${host}`;
}

export function payloadToString(payload: unknown): string | null {
	if (typeof payload === "string") return payload;
	if (Buffer.isBuffer(payload)) return payload.toString("utf8");
	return null;
}
