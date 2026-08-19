import type { FastifyReply } from "fastify";
import { applySecurityHeaders } from "../security/index.js";

/** Página 503 de un host puesto en mantenimiento por el modules-manager. */
export function serveMaintenance(reply: FastifyReply, message: string): void {
	applySecurityHeaders(reply);
	reply.header("Content-Type", "text/html; charset=utf-8");
	reply.header("Retry-After", "120");
	const safe = message.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
	reply.code(503).send(
		`<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">` +
			`<title>No disponible temporalmente</title><style>html,body{height:100%;margin:0}` +
			`body{display:flex;align-items:center;justify-content:center;background:#0f1115;color:#e6e6e6;` +
			`font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif}.box{max-width:32rem;padding:2rem;text-align:center}` +
			`h1{font-size:1.4rem;margin:0 0 .75rem}p{color:#a0aec0;line-height:1.5}</style></head>` +
			`<body><div class="box"><h1>No disponible temporalmente</h1><p>${safe}</p></div></body></html>`
	);
}
