import express, { Application, RequestHandler } from "express";
import cors from "cors";
import bodyParser from "body-parser";
import { Server } from "node:http";
import { BaseProvider, ProviderType } from "../../BaseProvider.js";
import { OnlyKernel } from "../../../utils/decorators/OnlyKernel.ts";
import { IHttpServerProvider } from "../../../interfaces/modules/providers/IHttpServer.js";
import { expressConnectMiddleware } from "@connectrpc/connect-express";
import type { ConnectRouter, ServiceImpl } from "@connectrpc/connect";

/** Implementación del servidor HTTP con Express */
export default class ExpressServerProvider extends BaseProvider implements IHttpServerProvider {
	public readonly name = "express-server";
	public readonly type = ProviderType.HTTP_SERVER_PROVIDER;
	private readonly app: Application;
	private server: Server | null = null;
	private isListening = false;

	constructor() {
		super();
		this.app = express();
		this.#setupMiddleware();
	}

	@OnlyKernel()
	async start(kernelKey: symbol): Promise<void> {
		await super.start(kernelKey);
	}

	/** Configura el middleware común de Express */
	#setupMiddleware(): void {
		this.app.use(cors()); // CORS para permitir peticiones cross-origin

		// Body parser para JSON y URL encoded
		this.app.use(bodyParser.json());
		this.app.use(bodyParser.urlencoded({ extended: true }));

		// Log de peticiones en desarrollo
		if (process.env.NODE_ENV === "development")
			this.app.use((req: any, _res: any, next: any) => {
				this.logger.logDebug(`${req.method} ${req.path}`);
				next();
			});
	}

	registerRoute(method: string, path: string, handler: RequestHandler): void {
		const methodLower = method.toLowerCase() as keyof Application;
		if (typeof this.app[methodLower] === "function") {
			(this.app[methodLower] as any)(path, handler);
			this.logger.logDebug(`Ruta registrada: ${method.toUpperCase()} ${path}`);
		} else this.logger.logError(`Método HTTP inválido: ${method}`);
	}

	serveStatic(path: string, directory: string): void {
		this.app.use(path, express.static(directory));
		this.logger.logDebug(`Archivos estáticos servidos: ${path} -> ${directory}`);
	}

	/**
	 * Registra rutas Connect RPC
	 * @param routes Función que define las rutas Connect RPC
	 * @param options Opciones para Connect RPC
	 */
	registerConnectRPC(routes: (router: ConnectRouter) => void, options?: { prefix?: string }): void {
		try {
			const middleware = expressConnectMiddleware({ routes });
			const prefix = options?.prefix || "/";
			this.app.use(prefix, middleware);
			const withPrefix = options?.prefix ? `con prefijo ${options.prefix}` : "";
			this.logger.logDebug(`Connect RPC registrado${withPrefix}`);
		} catch (error: any) {
			this.logger.logError(`Error registrando Connect RPC: ${error.message}`);
			throw error;
		}
	}

	/**
	 * Registra un servicio Connect RPC individual
	 * @param service Implementación del servicio
	 * @param options Opciones de configuración
	 */
	registerConnectService(service: Partial<ServiceImpl<any>>, options?: { prefix?: string }): void {
		this.registerConnectRPC((router) => {
			router.service(service as any, service);
		}, options);
	}

	async listen(port: number): Promise<void> {
		if (this.isListening) return this.logger.logWarn("El servidor ya está escuchando");

		return new Promise((resolve, reject) => {
			try {
				this.server = this.app.listen(port, () => {
					this.isListening = true;
					this.logger.logOk(`Servidor HTTP escuchando en puerto ${port}`);
					resolve();
				});

				this.server?.on("error", (error: any) => {
					if (error.code === "EADDRINUSE") this.logger.logError(`Puerto ${port} ya está en uso`);
					else this.logger.logError(`Error en el servidor: ${error.message}`);

					reject(error);
				});
			} catch (error) {
				reject(error);
			}
		});
	}

	@OnlyKernel()
	async stop(kernelKey: symbol): Promise<void> {
		super.stop(kernelKey);
		if (this.server && this.isListening) {
			return new Promise((resolve, reject) => {
				this.server!.close((err) => {
					if (err) {
						this.logger.logError(`Error cerrando servidor: ${err}`);
						reject(err);
					} else {
						this.isListening = false;
						this.logger.logOk("Servidor HTTP detenido");
						resolve();
					}
				});
			});
		}
	}
}
