import { Type } from "@sinclair/typebox";
import { RegisterEndpoint, type EndpointCtx } from "@services/core/EndpointManagerService/index.js";
import { P } from "@common/types/Permissions.ts";
import type { LogLevel, LogQuery } from "@common/utils/log-buffer.ts";
import type LogManagerService from "../index.js";

const LOG_LEVELS = ["info", "ok", "warn", "error", "debug"] as const;
const MAX_Q = 100;
const MAX_MODULE = 120;
/** Los identificadores de nodo son slugs cortos; el tope sólo acota lo que se copia a la URL saliente. */
const MAX_NODE = 64;
const DEFAULT_LIMIT = 200;
const MAX_LIMIT = 1000;

const LogLevelSchema = Type.Union(
	LOG_LEVELS.map((l) => Type.Literal(l)),
	{ description: "Nivel exacto; sin él vienen todos" }
);

const LogsQuery = Type.Object({
	level: Type.Optional(LogLevelSchema),
	module: Type.Optional(Type.String({ maxLength: MAX_MODULE, description: "Nombre exacto o prefijo (los sub-loggers son `Padre:Hijo`)" })),
	q: Type.Optional(Type.String({ maxLength: MAX_Q, description: "Substring case-insensitive sobre mensaje y módulo" })),
	limit: Type.Optional(Type.String({ pattern: String.raw`^\d+$`, description: `1..${MAX_LIMIT} (default ${DEFAULT_LIMIT})` })),
	cursor: Type.Optional(Type.String({ pattern: String.raw`^\d+$`, description: "`seq` de la última entrada recibida" })),
	node: Type.Optional(
		Type.String({ maxLength: MAX_NODE, description: "`ADC_NODE_ID` del nodo a consultar; sin él, el que atiende el request" })
	),
});

const LogEntrySchema = Type.Object({
	seq: Type.Integer({ description: "Secuencia monótona del proceso; es también el cursor de paginación" }),
	ts: Type.String({ description: "ISO 8601" }),
	level: LogLevelSchema,
	module: Type.String(),
	message: Type.String({ description: "Ya redactado en origen (tokens/secretos enmascarados al escribir)" }),
});

const LogsResponse = Type.Object({
	logs: Type.Array(LogEntrySchema, { description: "Del más nuevo al más viejo" }),
	nextCursor: Type.Union([Type.Integer(), Type.Null()], { description: "`seq` desde donde seguir; `null` si no hay más" }),
	modules: Type.Array(Type.String(), { description: "Módulos vistos por el buffer, para poblar el filtro de la UI" }),
	nodeId: Type.String({ description: "Nodo cuyo buffer se leyó: el `seq` y los módulos son suyos, no de la flota" }),
});

/** Entero de query string con clamp: el validador no coerciona, los params llegan como string. */
function toInt(v: string | undefined, min: number, max: number): number | undefined {
	const n = Number(v);
	if (!v || !Number.isFinite(n)) return undefined;
	return Math.min(Math.max(Math.trunc(n), min), max);
}

/** Nivel conocido o `undefined`. El `find` sobre la tupla evita castear input del usuario. */
function toLevel(v: string | undefined): LogLevel | undefined {
	return LOG_LEVELS.find((l) => l === v);
}

/**
 * Consulta de los logs del proceso.
 *
 * Vive acá y no en el panel de administración porque **el buffer es del core**: en un preset
 * opcional, una instalación sin él produciría logs que nadie puede consultar.
 *
 * Permiso `modules.logs` (bit propio, no `runtime`): los logs arrastran datos de cualquier dominio,
 * así que verlos es más fuerte que operar módulos. El recurso `modules` es `globalOnly`, y además
 * se exige contexto global.
 */
export class LogsEndpoints {
	private static service: LogManagerService;

	static init(service: LogManagerService): void {
		LogsEndpoints.service ??= service;
	}

	@RegisterEndpoint({
		method: "GET",
		url: "/api/logs",
		permissions: [P.MODULES.LOGS.READ],
		options: {
			tag: "LogManagerService/Logs",
			summary: "Logs recientes del proceso (buffer en memoria) filtrados por nivel/módulo/texto, paginados por `seq`",
			description:
				"Ring buffer del proceso del kernel, no un almacén: sólo entran las últimas N líneas y nada sobrevive a un reinicio. " +
				"`q` es substring (nunca se compila como regex) y `cursor` pagina hacia atrás con el `seq` de la última entrada recibida. " +
				"No incluye lo que loguean los worker_threads, que tienen su propia copia del logger. " +
				"Con `node` se consulta EN VIVO el buffer de otro nodo del registro (reenviando la sesión de quien pregunta): " +
				"nada se agrega ni se persiste, cada buffer sigue siendo del proceso que lo escribió.",
			rateLimit: { max: 120, timeWindow: 60_000 },
			schema: { querystring: LogsQuery, response: { 200: LogsResponse } },
		},
	})
	static logs(ctx: EndpointCtx) {
		LogsEndpoints.service.assertGlobalContext(ctx);
		const filter: LogQuery = {
			level: toLevel(ctx.query.level),
			module: ctx.query.module?.trim().slice(0, MAX_MODULE) || undefined,
			q: ctx.query.q?.trim().slice(0, MAX_Q) || undefined,
			limit: toInt(ctx.query.limit, 1, MAX_LIMIT) ?? DEFAULT_LIMIT,
			cursor: toInt(ctx.query.cursor, 1, Number.MAX_SAFE_INTEGER),
		};
		return LogsEndpoints.service.queryBufferAt(ctx.query.node?.trim().slice(0, MAX_NODE) || undefined, filter, ctx);
	}
}
