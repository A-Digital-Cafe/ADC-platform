/**
 * Contrato público del **ModerationService** (clase principal).
 *
 * Vive en `@common` para que otros servicios consuman moderación por **interfaz**
 * sin importar la clase concreta de `@services`. La clase concreta hace
 * `implements IModerationService`. Toda la superficie operativa se expone tras el
 * gate `_internal` (scope `moderation:internal`).
 */

import type { ModerationInternalApi } from "@services/security/ModerationService/index.js";
import type { CapabilityToken } from "../../security/Capability.ts";

export interface IModerationService {
	_internal(token: CapabilityToken): ModerationInternalApi;
}
