/**
 * JSON-LD base de la comunidad. Reutiliza el builder transversal de `@common`
 * y sólo aporta lo propio del microfront (aquí, la marca por defecto de ADC).
 *
 * Otros microfronts hacen lo mismo variando lo que cambie, p.ej.
 * `createSeoGraph({ ...ADC_BRAND, siteName: "Status · ADC" })`.
 */
import { ADC_BRAND, createSeoGraph } from "@common/utils/seo/jsonld.js";

const seo = createSeoGraph(ADC_BRAND);

export const buildPageGraph = seo.buildPageGraph;
export const buildArticleGraph = seo.buildArticleGraph;
