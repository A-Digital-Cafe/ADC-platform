import type { Model } from "mongoose";
import { BaseService } from "../../BaseService.js";
import type MongoProvider from "../../../providers/object/mongo/index.js";
import type { Kernel } from "../../../kernel.js";
import { Scope, assertScope, Capability, type CapabilityToken } from "@common/security/Capability.ts";
import {
	AUDIT_LOG_DEFAULT_RETENTION_DAYS,
	type AuditEntryInput,
	type AuditLogPage,
	type AuditLogQuery,
	type AuditLogRecord,
	type IAuditLogService,
} from "@common/types/security/AuditLog.ts";
import { AuditError } from "@common/types/custom-errors/AuditError.ts";
import { buildAuditLogSchema } from "./domain/audit-log.ts";
import { AuditLogRepository } from "./dao/AuditLogRepository.ts";
import { EnableEndpoints, DisableEndpoints } from "../../core/EndpointManagerService/index.js";
import { AuditEndpoints } from "./endpoints/audit.ts";

interface AuditPrivateConfig {
	retention?: { auditRetentionDays?: number | string };
}

/**
 * Registro persistente y append-only de acciones administrativas sobre datos personales
 * (accountability art. 5.2 RGPD / art. 9 Ley 25.326). Se escribe con `record`/`recordStrict`
 * (capability `audit:write`) y se lee por `/api/security/audit-log` (`security.audit_log`).
 */
export default class AuditLogService extends BaseService implements IAuditLogService {
	public readonly name = "AuditLogService";

	readonly #mongoProvider: MongoProvider;
	#repo: AuditLogRepository | null = null;

	constructor(kernel: Kernel, options?: ConstructorParameters<typeof BaseService>[1]) {
		super(kernel, options);
		this.#mongoProvider = this.getMyProvider<MongoProvider>("object/mongo");
	}

	@EnableEndpoints({ managers: () => [AuditEndpoints] })
	async start(kernelKey: symbol): Promise<void> {
		await super.start(kernelKey);
		await this.#waitConnected(this.#mongoProvider);

		const model = this.#mongoProvider.createModel<AuditLogRecord>("audit_log", buildAuditLogSchema(this.#retentionSeconds()));
		await this.#ensureIndexes(model);
		this.#repo = new AuditLogRepository(model);

		AuditEndpoints.init(this);
		this.logger.logOk(`${this.name} iniciado`);
	}

	@DisableEndpoints()
	async stop(kernelKey: symbol): Promise<void> {
		await super.stop(kernelKey);
		this.#repo = null;
	}

	/** Pre-flight barato para flujos fail-closed: hay repo y Mongo responde. */
	isWritable(): boolean {
		return this.#repo !== null && this.#mongoProvider.isConnected();
	}

	/** Escritura best-effort: un fallo de auditoría no aborta la acción del productor. */
	async record(token: CapabilityToken, entry: AuditEntryInput): Promise<void> {
		try {
			await this.#append(token, entry);
		} catch (err: any) {
			this.logger.logWarn(`[AuditLogService] entrada '${entry?.action}' no registrada: ${err?.message || err}`);
		}
	}

	/**
	 * Escritura fail-closed: si la entrada no quedó persistida, lanza `AuditError`. La falta de
	 * scope y el input inválido propagan tal cual: no son indisponibilidad sino mal cableado.
	 */
	async recordStrict(token: CapabilityToken, entry: AuditEntryInput): Promise<void> {
		if (!this.isWritable()) {
			throw new AuditError(503, "AUDIT_UNAVAILABLE", "Registro de auditoría no disponible");
		}
		try {
			await this.#append(token, entry);
		} catch (err: any) {
			if (err instanceof AuditError || err?.name === "CapabilityError") throw err;
			throw new AuditError(500, "AUDIT_WRITE_FAILED", `No se pudo persistir la entrada de auditoría: ${err?.message || err}`);
		}
	}

	/** Página del audit log (para el endpoint admin; el contenido es no-PII por diseño). */
	async listAudit(opts: AuditLogQuery): Promise<AuditLogPage> {
		return this.#requireRepo().getPage(opts);
	}

	// ─── Privados ─────────────────────────────────────────────────────────────

	async #append(token: CapabilityToken, entry: AuditEntryInput): Promise<void> {
		assertScope(token, Scope.AuditWrite);
		// `origin` sale del titular de la capability: el productor no puede firmar como otro.
		const origin = Capability.is(token) ? token.owner : "kernel";
		await this.#requireRepo().append(origin, entry);
	}

	#requireRepo(): AuditLogRepository {
		if (!this.#repo) throw new AuditError(503, "AUDIT_UNAVAILABLE", "AuditLogService no inicializado");
		return this.#repo;
	}

	#retentionSeconds(): number {
		const days = Number((this.config?.private as AuditPrivateConfig | undefined)?.retention?.auditRetentionDays);
		return (Number.isFinite(days) && days > 0 ? days : AUDIT_LOG_DEFAULT_RETENTION_DAYS) * 24 * 60 * 60;
	}

	/** Ver `buildAuditLogSchema`: los índices se sincronizan acá para que un cambio del TTL no rompa el arranque. */
	async #ensureIndexes(model: Model<AuditLogRecord>): Promise<void> {
		try {
			await model.syncIndexes();
		} catch (err: any) {
			this.logger.logWarn(`[AuditLogService] syncIndexes de audit_log falló: ${err?.message || err}`);
		}
	}

	async #waitConnected(provider: MongoProvider): Promise<void> {
		const t0 = Date.now();
		while (!provider.isConnected() && Date.now() - t0 < 10000) await new Promise((r) => setTimeout(r, 250));
		if (!provider.isConnected()) throw new Error("[AuditLogService] Mongo no se conectó en el tiempo esperado");
	}
}
