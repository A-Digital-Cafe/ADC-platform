import { MeEndpoints } from "./me.ts";
import { CatalogEndpoints } from "./catalog.ts";
import { AdminCatalogEndpoints } from "./admin-catalog.ts";
import { AdminExpansionEndpoints } from "./admin-expansion.ts";
import { AdminOverridesEndpoints } from "./admin-overrides.ts";

/** Clases de endpoints del servicio: las registra `@EnableEndpoints` y las inicializa `start()`. */
export const PLAN_ENDPOINTS = [MeEndpoints, CatalogEndpoints, AdminCatalogEndpoints, AdminExpansionEndpoints, AdminOverridesEndpoints];
