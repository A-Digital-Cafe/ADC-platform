/**
 * Contrato público del **UIFederationService** (clase principal).
 *
 * Vive en `@common` para que las apps (vía `BaseApp`) registren/desregistren sus
 * módulos UI por **interfaz** sin importar la clase concreta de `@services`. La
 * clase concreta hace `implements IUIFederationService`.
 */

import type { UIModuleConfig } from "../../../interfaces/modules/IUIModule.js";
import type { Capability } from "../../security/Capability.ts";

export interface IUIFederationService {
	/** Registra un módulo UI. Requiere capability con scope `ui:register`. */
	registerUIModule(token: Capability, name: string, appDir: string, uiConfig: UIModuleConfig): Promise<void>;
	/** Desregistra un módulo UI. Requiere capability con scope `ui:register`. */
	unregisterUIModule(token: Capability, name: string, namespace?: string): Promise<void>;
}
