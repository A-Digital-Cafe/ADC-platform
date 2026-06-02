/**
 * JSON-LD base del landing raíz de ADC. Reutiliza el builder transversal de
 * `@common` con la marca por defecto (este microfront ES el sitio principal,
 * así que `siteName` coincide con `brandName`).
 */
import { ADC_BRAND, createSeoGraph } from "@common/utils/seo/jsonld.js";

const seo = createSeoGraph(ADC_BRAND);

export const buildPageGraph = seo.buildPageGraph;
