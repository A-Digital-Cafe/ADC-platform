import * as fs from "node:fs";
import type { FastifyReply } from "fastify";
import type { ILogger } from "../../../../interfaces/utils/ILogger.js";
import type { HostOptions, StaticAccessGuard } from "../../../../interfaces/modules/providers/IHttpServer.js";
import { resolveSafeStaticPath } from "../security/index.js";

export interface GlobalStaticHit {
	filePath: string;
	directory: string;
	mountPath: string;
}

/** Prefijos estáticos globales (los módulos UI sin `hosting`), sus gates y los prefijos no indexables. */
export class StaticStore {
	readonly #mounts = new Map<string, string>();
	/** Gates de acceso por prefijo estático global. */
	readonly #guards = new Map<string, StaticAccessGuard>();
	/** Gates acotados a un archivo dentro de un prefijo (chunks federados). */
	readonly #pathGuards = new Map<string, NonNullable<HostOptions["pathGuards"]>>();
	/** Prefijos de URL que salen `noindex` en todos los hosts. */
	readonly #noIndex = new Set<string>();

	constructor(private readonly logger: ILogger) {}

	mount(urlPath: string, directory: string, options?: Pick<HostOptions, "accessGuard" | "pathGuards">): void {
		this.#mounts.set(urlPath, directory);
		if (options?.accessGuard) this.#guards.set(urlPath, options.accessGuard);
		else this.#guards.delete(urlPath);
		if (options?.pathGuards?.length) this.#pathGuards.set(urlPath, options.pathGuards);
		else this.#pathGuards.delete(urlPath);
		const gated = options?.accessGuard || options?.pathGuards?.length ? " (con gate de acceso)" : "";
		this.logger.logDebug(`Archivos estáticos globales: ${urlPath} -> ${directory}${gated}`);
	}

	/**
	 * Ruta estática global que sirve `urlPath`, o `null` si ninguna tiene ese archivo.
	 *
	 * **Gana el prefijo más largo**, no el primero registrado: `common/public` se monta en `/`
	 * durante el registro del primer módulo UI, y `/` es prefijo de todo, así que por orden de
	 * inserción se tragaba `/ui`, `/pub` y los `/<namespace>/<módulo>` — quedaban registrados y
	 * eran inalcanzables.
	 *
	 * Exige que el archivo exista para devolverlo: así un `/ui/x` que no está en la UI library
	 * puede seguir cayendo al `common/public` de abajo, en vez de cortar con 404 en el primer
	 * prefijo que matchee.
	 */
	resolve(urlPath: string): GlobalStaticHit | null {
		const byLongestPrefix = [...this.#mounts.entries()].sort((a, b) => b[0].length - a[0].length);

		for (const [pathPrefix, directory] of byLongestPrefix) {
			// Frontera de segmento: `/ui` no puede matchear `/uicorp/logo.png`.
			const prefix = pathPrefix.endsWith("/") ? pathPrefix.slice(0, -1) : pathPrefix;
			if (prefix && urlPath !== prefix && !urlPath.startsWith(`${prefix}/`)) continue;

			const rest = urlPath.slice(prefix.length);
			const relativePath = rest === "" || rest === "/" ? "/index.html" : rest;
			const filePath = resolveSafeStaticPath(directory, relativePath);
			if (filePath && fs.existsSync(filePath) && fs.statSync(filePath).isFile()) return { filePath, directory, mountPath: pathPrefix };
		}

		return null;
	}

	guardFor(mountPath: string): StaticAccessGuard | undefined {
		return this.#guards.get(mountPath);
	}

	pathGuardFor(mountPath: string, normalizedPath: string | null): StaticAccessGuard | undefined {
		return this.#pathGuards.get(mountPath)?.find((entry) => normalizedPath?.startsWith(entry.prefix))?.guard;
	}

	/**
	 * Marca un prefijo de URL como no indexable: todo lo que se sirva debajo sale con
	 * `X-Robots-Tag: noindex`.
	 *
	 * Lo usa la UI federation para su prefijo de namespace (`/adc-platform/…`), que es
	 * infraestructura de carga de módulos y no contenido. Vive en el provider y no en el
	 * `SEOService` por lo mismo que el `robots.txt`: ese preset es opcional, y un despliegue sin él
	 * no puede quedar publicando el shell de la app bajo una URL por cada módulo del namespace.
	 *
	 * `noindex` y no `Disallow`: el prefijo tiene que seguir siendo rastreable —de ahí cuelgan el
	 * loader de i18n y los assets de la UI library, sin los cuales Google no puede renderizar la
	 * página— y, además, una URL ya indexada sólo sale del índice si el crawler puede volver a
	 * verla para leer el `noindex`.
	 */
	addNoIndexPrefix(prefix: string): void {
		const normalized = prefix.endsWith("/") ? prefix : `${prefix}/`;
		if (this.#noIndex.has(normalized)) return;
		this.#noIndex.add(normalized);
		this.logger.logDebug(`Prefijo no indexable: ${normalized}`);
	}

	/** Sella `X-Robots-Tag` si el path cae bajo un prefijo no indexable y nadie lo declaró antes. */
	applyNoIndex(reply: FastifyReply, normalizedPath: string | null): void {
		if (!normalizedPath || reply.getHeader("X-Robots-Tag")) return;
		for (const prefix of this.#noIndex) {
			if (normalizedPath.startsWith(prefix)) {
				reply.header("X-Robots-Tag", "noindex");
				return;
			}
		}
	}
}
