import type MongoProvider from "@providers/object/mongo/index.js";
import { BaseService } from "@services/BaseService.js";
import { EnableEndpoints, DisableEndpoints } from "@services/core/EndpointManagerService/index.js";
import type { IIdentityManagerService } from "@common/types/identity/IIdentityManagerService.js";
import { OnlyKernel } from "@adc/utils/decorators/OnlyKernel.ts";
import { Scope, assertScope, type Capability } from "@common/security/Capability.ts";
import { Kernel } from "@kernel";
import type { QuotaTracker, QuotaTrackerGetter, StorageLimitOverride } from "@common/types/storage/quota.ts";
import type { IStorageQuotaService } from "@common/types/storage/IStorageQuotaService.ts";
import { StorageError } from "@common/types/custom-errors/StorageError.ts";
import { storageUsageSchema, type StorageUsageDoc } from "./domain/usage.ts";
import { storageLimitOverrideSchema } from "./domain/limitOverride.ts";
import { QuotaManager, type RegisteredApp } from "./dao/QuotaManager.ts";
import { LimitsManager } from "./dao/LimitsManager.ts";
import { UsageEndpoints } from "./endpoints/usage.ts";
import { LimitsEndpoints } from "./endpoints/limits.ts";

/**
 * Resolver perezoso de StorageQuotaService. El consumer lo provee resolviendo su
 * **dependencia declarada** (`this.tryGetMyService("StorageQuotaService")`), de modo
 * que estos helpers no necesitan acceso crudo al kernel.
 */
export type QuotaResolver = () => IStorageQuotaService | undefined;

/** Getter lazy del tracker para consumers: null si el servicio no está cargado. */
export function createQuotaTrackerGetter(resolveQuota: QuotaResolver): QuotaTrackerGetter {
	return () => {
		try {
			return resolveQuota()?.tracker ?? null;
		} catch {
			return null;
		}
	};
}

/** Registra una app consumidora si el servicio está disponible; false si no lo está. */
export function registerStorageApp(resolveQuota: QuotaResolver, token: Capability, app: RegisteredApp): boolean {
	try {
		const quota = resolveQuota();
		if (!quota) return false;
		quota.registerApp(token, app);
		return true;
	} catch {
		return false;
	}
}

/**
 * Tracking centralizado del uso de almacenamiento (attachments) por usuario,
 * cross apps/services, con límites por tier y overrides administrables.
 *
 * Las apps consumidoras se registran con `registerApp(kernelKey, ...)` y los
 * AttachmentsManager reportan vía el `tracker` (checkAllowance/commit/release).
 */
export default class StorageQuotaService extends BaseService implements IStorageQuotaService {
	public readonly name = "StorageQuotaService";

	#quotaManager: QuotaManager | null = null;
	#limitsManager: LimitsManager | null = null;
	#identity: IIdentityManagerService | null = null;
	#internalIdentity: ReturnType<IIdentityManagerService["_internal"]> | null = null;
	#reconcileTimer: ReturnType<typeof setInterval> | null = null;

	private mongoProvider!: MongoProvider;

	constructor(kernel: Kernel, options?: any) {
		super(kernel, options);
	}

	@EnableEndpoints({ managers: () => [UsageEndpoints, LimitsEndpoints] })
	async start(kernelKey: symbol): Promise<void> {
		await super.start(kernelKey);

		this.mongoProvider = this.getMyProvider<MongoProvider>("object/mongo");
		await this.waitForMongo();

		this.#identity = this.getMyService<IIdentityManagerService>("IdentityManagerService");
		this.#internalIdentity = this.#identity._internal(this.getCapability());
		const internal = this.#internalIdentity;

		const UsageModel = this.mongoProvider.createModel<StorageUsageDoc>("storage_usage", storageUsageSchema);
		const OverrideModel = this.mongoProvider.createModel<StorageLimitOverride>("storage_limit_overrides", storageLimitOverrideSchema);

		this.#limitsManager = new LimitsManager(
			OverrideModel,
			{
				getUser: (userId) => internal.users.getUser(userId),
				getOrganization: (orgIdOrSlug) => internal.organizations.getOrganization(orgIdOrSlug),
				getRole: (roleId) => internal.roles.getRole(roleId),
			},
			this.logger
		);
		this.#quotaManager = new QuotaManager(UsageModel, this.#limitsManager, this.logger);

		UsageEndpoints.init(this, kernelKey);
		LimitsEndpoints.init(this, kernelKey);

		// Identity (kernelMode menor) ya arrancó: registrar la app de avatares aquí.
		// Superficie de avatar separada por scope (`identity:avatar`).
		const avatarAttachments = this.#identity._internalAvatar(this.getCapability()).avatarAttachments;
		if (avatarAttachments) {
			this.#quotaManager.registerApp({
				appId: "avatars",
				label: "Avatares",
				computeUsage: () => avatarAttachments.aggregateUsageByUser(kernelKey),
			});
		}

		const reconcileIntervalMs = Number((this.config?.private as { reconcileIntervalMs?: number } | undefined)?.reconcileIntervalMs ?? 0);
		if (reconcileIntervalMs > 0) {
			this.#reconcileTimer = setInterval(() => {
				this.#quotaManager?.reconcile().catch((e) => this.logger.logWarn(`StorageQuota: reconcile periódico falló: ${e.message}`));
			}, reconcileIntervalMs);
		}

		this.logger.logOk("StorageQuotaService iniciado");
	}

	/** Tracker para AttachmentsManager (interfaz estable de @common/types/storage/quota). */
	get tracker(): QuotaTracker {
		const quota = this.quota;
		return {
			checkAllowance: (subject, appId, sizeBytes) => quota.checkAllowance(subject, appId, sizeBytes),
			commit: (subject, appId, bytes) => quota.commit(subject, appId, bytes),
			release: (subject, appId, bytes) => quota.release(subject, appId, bytes),
		};
	}

	get quota(): QuotaManager {
		if (!this.#quotaManager) throw new StorageError(503, "QUOTA_UNAVAILABLE", "QuotaManager no inicializado");
		return this.#quotaManager;
	}

	get limits(): LimitsManager {
		if (!this.#limitsManager) throw new StorageError(503, "QUOTA_UNAVAILABLE", "LimitsManager no inicializado");
		return this.#limitsManager;
	}

	/** Registra una app consumidora (la llaman otros services en su `start()`). Scope `storage:register`. */
	registerApp(token: Capability, app: RegisteredApp): void {
		assertScope(token, Scope.StorageRegister);
		this.quota.registerApp(app);
	}

	/** En contexto org, el usuario objetivo debe ser miembro de la org del caller. */
	@OnlyKernel()
	async assertUserVisibleFromContext(_kernelKey: symbol, targetUserId: string, callerOrgId: string | null): Promise<void> {
		if (!callerOrgId) return;
		const user = await this.#internalIdentity?.users.getUser(targetUserId);
		if (!user) throw new StorageError(404, "SUBJECT_NOT_FOUND", "Usuario no encontrado");
		const isMember = user.orgMemberships?.some((m) => m.orgId === callerOrgId) ?? false;
		if (!isMember) throw new StorageError(403, "ORG_ACCESS_DENIED", "No tienes acceso a este usuario");
	}

	/** Uso agregado de una org: suma de los contadores del CONTEXTO org (sin uso personal de los miembros). */
	@OnlyKernel()
	async getOrgUsage(_kernelKey: symbol, orgId: string) {
		const internal = this.#internalIdentity;
		if (!internal) throw new StorageError(503, "QUOTA_UNAVAILABLE", "Identity no disponible");

		const [orgLimit, members, usageRows] = await Promise.all([
			this.limits.resolveOrgLimit(orgId),
			internal.users.getAllUsers(undefined, orgId),
			this.quota.getOrgUsageRows(orgId),
		]);
		const usernameById = new Map(members.map((m) => [m.id, m.username]));

		let totalBytes = 0;
		let totalCount = 0;
		// Docs de ex-miembros: siguen siendo storage real de la org (username undefined).
		const rows = usageRows.map((u) => {
			totalBytes += u.totalBytes;
			totalCount += u.totalCount;
			return { userId: u.userId, username: usernameById.get(u.userId), totalBytes: u.totalBytes, totalCount: u.totalCount };
		});
		rows.sort((a, b) => b.totalBytes - a.totalBytes);

		return {
			orgId,
			orgLimit,
			totalBytes,
			totalCount,
			members: rows.slice(0, 200),
			memberCount: members.length,
		};
	}

	toOverrideDto(o: StorageLimitOverride) {
		return {
			id: o.id,
			subjectType: o.subjectType,
			subjectId: o.subjectId,
			orgId: o.orgId ?? null,
			limitBytes: o.limitBytes,
			createdBy: o.createdBy,
			createdAt: new Date(o.createdAt).toISOString(),
			updatedAt: new Date(o.updatedAt).toISOString(),
		};
	}

	@DisableEndpoints()
	async stop(kernelKey: symbol): Promise<void> {
		await super.stop(kernelKey);
		if (this.#reconcileTimer) {
			clearInterval(this.#reconcileTimer);
			this.#reconcileTimer = null;
		}
		this.logger.logOk("StorageQuotaService detenido");
	}

	private async waitForMongo(): Promise<void> {
		const maxWaitTime = 10000;
		const startTime = Date.now();
		while (!this.mongoProvider.isConnected() && Date.now() - startTime < maxWaitTime) {
			await new Promise((resolve) => setTimeout(resolve, 500));
		}
		if (!this.mongoProvider.isConnected()) {
			throw new Error("MongoDB no pudo conectarse en el tiempo esperado");
		}
	}
}
