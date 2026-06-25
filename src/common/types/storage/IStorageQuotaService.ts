/**
 * Contrato público del **StorageQuotaService** (clase principal).
 *
 * Vive en `@common` para que apps y servicios (incluidos presets) consuman el
 * servicio de cuotas por **interfaz**, sin importar la clase concreta de
 * `@services`. La clase concreta hace `implements IStorageQuotaService`.
 */

import type { QuotaTracker } from "./quota.ts";
import type { RegisteredApp } from "@services/data/StorageQuotaService/dao/QuotaManager.js";
import type { Capability } from "../../security/Capability.ts";

export interface IStorageQuotaService {
	/** Tracker estable para que los AttachmentsManager reporten uso. */
	readonly tracker: QuotaTracker;
	/** Registra una app consumidora. Requiere capability con scope `storage:register`. */
	registerApp(token: Capability, app: RegisteredApp): void;
}
