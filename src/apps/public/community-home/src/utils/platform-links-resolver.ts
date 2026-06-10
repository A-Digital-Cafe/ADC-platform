/**
 * Resolver de enlaces de plataforma para la app Community, expuesto como remote
 * de Module Federation (`./platformLinkResolver` en `config.json`).
 *
 * Cuando un chip `adc-platform-link` apunta a un artículo o ruta de aprendizaje
 * de Community, resuelve su título real vía `contentLinkAPI`. Lo consume cualquier
 * app (incluso sin haber abierto Community) cargando este remote bajo demanda.
 * Para otras rutas deja el fallback por defecto (ruta legible).
 *
 * El control de acceso es server-side: el backend oculta borradores
 * (`listed:false`) y rutas privadas (`public:false`) a quien no es su autor / no
 * tiene el rol de publicación, devolviendo 403 → el chip muestra "sin acceso".
 */
import type { PlatformLinkRef, PlatformLinkResolver } from "@ui-library/utils/platform-links";

import { contentLinkAPI } from "./content-api";

/** 401/403 → sin acceso; cualquier otro fallo → entidad inexistente. */
function statusFromHttp(httpStatus?: number): "denied" | "missing" {
	return httpStatus === 401 || httpStatus === 403 ? "denied" : "missing";
}

const resolvePlatformLink: PlatformLinkResolver = async (ref: PlatformLinkRef) => {
	const [section, slug] = ref.segments;
	if (!slug) return null;

	if (section === "articles") {
		const { title, status } = await contentLinkAPI.getArticle(slug);
		return title ? { title } : { status: statusFromHttp(status) };
	}

	if (section === "paths") {
		const { title, status } = await contentLinkAPI.getPath(slug);
		return title ? { title } : { status: statusFromHttp(status) };
	}

	return null;
};

export default resolvePlatformLink;
