import { BaseService } from "../../BaseService.js";
import { OnlyKernel } from "../../../utils/decorators/OnlyKernel.ts";
import type { IHostBasedHttpProvider } from "@interfaces/modules/providers/IHttpServer.js";
import { registerS3ProxyRoutes } from "./proxy.js";

/**
 * Expone el object storage interno (Garage) a los navegadores sobre un vhost de la plataforma,
 * sin nginx de por medio. Deshabilitado salvo que `S3_GATEWAY_PUBLIC_HOST` esté seteado: en dev
 * el navegador llega al S3 local directo y este servicio no tiene nada que hacer.
 *
 * Las URLs presignadas se firman contra el vhost vía `S3_PUBLIC_ENDPOINT` (opción
 * `publicEndpoint` del `internal-s3-provider`); acá sólo se piped el tráfico.
 */
export default class S3GatewayService extends BaseService {
	public readonly name = "S3GatewayService";

	#httpProvider: IHostBasedHttpProvider | null = null;

	@OnlyKernel()
	async start(kernelKey: symbol): Promise<void> {
		await super.start(kernelKey);
		const cfg = (this.config?.private ?? {}) as { publicHost?: string; upstream?: string };
		const publicHost = (cfg.publicHost ?? "").trim().toLowerCase();
		if (!publicHost) {
			this.logger.logInfo("[S3Gateway] Sin S3_GATEWAY_PUBLIC_HOST: gateway deshabilitado");
			return;
		}
		const upstream = (cfg.upstream ?? "").trim() || "127.0.0.1:3900";
		const [upstreamHost, upstreamPortRaw] = upstream.split(":");
		const upstreamPort = Number(upstreamPortRaw) || 3900;

		this.#httpProvider = this.getMyProvider<IHostBasedHttpProvider>("fastify-server");
		registerS3ProxyRoutes({
			httpProvider: this.#httpProvider,
			publicHost,
			upstreamHost: upstreamHost || "127.0.0.1",
			upstreamPort,
			owner: this.name,
			logger: this.logger,
		});
		this.logger.logOk(`[S3Gateway] ${publicHost} → ${upstreamHost}:${upstreamPort}`);
	}

	@OnlyKernel()
	async stop(kernelKey: symbol): Promise<void> {
		await super.stop(kernelKey);
		this.#httpProvider?.unregisterRoutesByOwner?.(this.name);
		this.#httpProvider = null;
	}
}
