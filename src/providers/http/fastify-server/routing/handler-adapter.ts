import type { FastifyRequest, FastifyReply } from "fastify";
import type { HttpHandler } from "../../../../interfaces/modules/providers/IHttpServer.js";
import type { FastifyHandler } from "../types.js";

/** Detecta si un handler es de Express (tiene 3 params: req, res, next). */
function isExpressHandler(handler: HttpHandler): boolean {
	return handler.length >= 3;
}

/** Adapta un handler de Express a Fastify (solo cuando es necesario). */
function adaptExpressHandler(handler: any): FastifyHandler {
	return async (req: FastifyRequest, reply: FastifyReply) => {
		const expressRes = {
			status: (code: number) => {
				reply.code(code);
				return expressRes;
			},
			json: (data: any) => reply.send(data),
			send: (data: any) => reply.send(data),
			redirect: (url: string) => reply.redirect(url),
			setHeader: (key: string, value: string) => {
				reply.header(key, value);
				return expressRes;
			},
			header: (key: string, value: string) => {
				reply.header(key, value);
				return expressRes;
			},
			type: (contentType: string) => {
				reply.type(contentType);
				return expressRes;
			},
		};

		const next = (err?: any) => {
			if (err) reply.code(500).send({ error: err.message || "Internal error" });
		};

		await handler(req, expressRes, next);
	};
}

/** Normaliza un handler a formato Fastify. */
export function normalizeHandler(handler: HttpHandler): FastifyHandler {
	if (isExpressHandler(handler)) {
		return adaptExpressHandler(handler);
	}
	return handler as FastifyHandler;
}
