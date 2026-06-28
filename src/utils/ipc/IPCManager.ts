import * as os from "node:os";
import * as path from "node:path";
import * as net from "node:net";
import { promises as fs } from "node:fs";
import crypto from "node:crypto";
import { Logger } from "../logger/Logger.js";
import { safeParseJson } from "@common/utils/json-schema.ts";
import { ipcMessageCheck } from "@common/schemas/ipc-message.ts";

/**
 * Mensaje de IPC para comunicación entre procesos
 */
interface IPCMessage {
	/** ID único del mensaje */
	id: string;
	/** Tipo de mensaje: 'request' | 'response' | 'error' */
	type: "request" | "response" | "error";
	/** Método a invocar (solo para requests) */
	method?: string;
	/** Argumentos del método */
	args?: any[];
	/** Resultado de la llamada (solo para responses) */
	result?: any;
	/** Error si hubo (solo para errors) */
	error?: string;
}

/**
 * Configuración para crear un servidor IPC
 */
interface IPCServerConfig {
	moduleName: string;
	moduleVersion: string;
	language: string;
	handler: (method: string, args: any[]) => Promise<any>;
}

/**
 * Gestor de comunicación entre procesos mediante named pipes.
 * Compatible con Windows (named pipes) y Unix (Unix domain sockets).
 */
class IPCManager {
	private static readonly PIPE_BASE_PATH = os.platform() === "win32" ? "\\\\.\\pipe\\" : path.join(os.tmpdir(), "adc-platform");

	private readonly servers = new Map<string, net.Server>();
	private readonly clients = new Map<string, net.Socket>();
	private readonly pendingRequests = new Map<string, { resolve: (value: any) => void; reject: (error: any) => void }>();

	/**
	 * Genera la ruta del named pipe para un módulo específico
	 */
	static getPipePath(moduleName: string, moduleVersion: string, language: string): string {
		// Sanitizar el nombre del módulo (reemplazar / y \ por -)
		const safeModuleName = moduleName.replaceAll(/[/\\]/g, "-");
		const pipeName = `${safeModuleName}-${moduleVersion}-${language}`;
		if (os.platform() === "win32") {
			return `${IPCManager.PIPE_BASE_PATH}${pipeName}`;
		}
		return path.join(IPCManager.PIPE_BASE_PATH, pipeName);
	}

	/**
	 * Crea un servidor IPC para el módulo especificado
	 */
	async createServer(config: IPCServerConfig): Promise<void> {
		const pipePath = IPCManager.getPipePath(config.moduleName, config.moduleVersion, config.language);
		const serverKey = `${config.moduleName}-${config.moduleVersion}-${config.language}`;

		// Si ya existe un servidor, no crear otro
		if (this.servers.has(serverKey)) {
			Logger.debug(`[IPCManager] Servidor IPC ya existe para ${serverKey}`);
			return;
		}

		// Crear directorio base si no existe (solo en Unix)
		if (os.platform() !== "win32") {
			await fs.mkdir(IPCManager.PIPE_BASE_PATH, { recursive: true });
			// Eliminar pipe anterior si existe
			try {
				await fs.unlink(pipePath);
			} catch {
				// No existe, está bien
			}
		}

		const server = net.createServer((socket) => {
			Logger.debug(`[IPCManager] Cliente conectado a ${serverKey}`);

			let buffer = "";

			socket.on("data", async (data) => {
				buffer += data.toString();

				// Procesar mensajes completos (separados por newline)
				const messages = buffer.split("\n");
				buffer = messages.pop() || ""; // Guardar el último fragmento incompleto

				for (const msgStr of messages) {
					if (!msgStr.trim()) continue;

					try {
						const message = safeParseJson(msgStr, ipcMessageCheck);
						if (!message) {
							Logger.error(`[IPCManager] Mensaje IPC inválido descartado`);
							continue;
						}

						if (message.type === "request") {
							try {
								const result = await config.handler(message.method!, message.args || []);
								const response: IPCMessage = {
									id: message.id,
									type: "response",
									result,
								};
								socket.write(JSON.stringify(response) + "\n");
							} catch (error: any) {
								const errorResponse: IPCMessage = {
									id: message.id,
									type: "error",
									error: error.message || String(error),
								};
								socket.write(JSON.stringify(errorResponse) + "\n");
							}
						}
					} catch (error) {
						Logger.error(`[IPCManager] Error procesando mensaje: ${error}`);
					}
				}
			});

			socket.on("error", (error) => {
				Logger.error(`[IPCManager] Error en socket: ${error}`);
			});

			socket.on("end", () => {
				Logger.debug(`[IPCManager] Cliente desconectado de ${serverKey}`);
			});
		});

		return new Promise((resolve, reject) => {
			server.listen(pipePath, () => {
				Logger.info(`[IPCManager] Servidor IPC iniciado en ${pipePath}`);
				this.servers.set(serverKey, server);
				resolve();
			});

			server.on("error", (error) => {
				Logger.error(`[IPCManager] Error en servidor IPC: ${error}`);
				reject(error);
			});
		});
	}

	/**
	 * Obtiene o crea un cliente IPC para comunicarse con un módulo
	 */
	private async getOrCreateClient(moduleName: string, moduleVersion: string, language: string): Promise<net.Socket> {
		const clientKey = `${moduleName}-${moduleVersion}-${language}`;

		// Si ya existe un cliente conectado, reutilizarlo
		if (this.clients.has(clientKey)) {
			const client = this.clients.get(clientKey)!;
			if (!client.destroyed) {
				return client;
			}
			// Si está destruido, eliminarlo
			this.clients.delete(clientKey);
		}

		// Crear nuevo cliente
		const pipePath = IPCManager.getPipePath(moduleName, moduleVersion, language);
		const client = new net.Socket();

		let buffer = "";

		// Manejar respuestas
		client.on("data", (data) => {
			buffer += data.toString();

			const messages = buffer.split("\n");
			buffer = messages.pop() || "";

			for (const msgStr of messages) {
				if (!msgStr.trim()) continue;

				try {
					const message = safeParseJson(msgStr, ipcMessageCheck);
					if (!message) {
						Logger.error(`[IPCManager] Respuesta IPC inválida descartada`);
						continue;
					}
					const pending = this.pendingRequests.get(message.id);

					if (pending) {
						this.pendingRequests.delete(message.id);
						if (message.type === "response") {
							// Deserializar buffers si vienen en formato base64
							let result = message.result;
							const maybeBuffer = result as { __type?: string; data?: string } | null;
							if (maybeBuffer && typeof maybeBuffer === "object" && maybeBuffer.__type === "Buffer") {
								result = Buffer.from(maybeBuffer.data ?? "", "base64");
							}
							pending.resolve(result);
						} else if (message.type === "error") {
							pending.reject(new Error(message.error));
						}
					}
				} catch (error) {
					Logger.error(`[IPCManager] Error procesando respuesta: ${error}`);
				}
			}
		});

		client.on("error", (error) => {
			Logger.error(`[IPCManager] Error en cliente IPC ${clientKey}: ${error}`);
			this.clients.delete(clientKey);
		});

		client.on("close", () => {
			Logger.debug(`[IPCManager] Cliente IPC desconectado: ${clientKey}`);
			this.clients.delete(clientKey);
		});

		// Conectar al servidor
		return new Promise((resolve, reject) => {
			client.connect(pipePath, () => {
				Logger.debug(`[IPCManager] Cliente IPC conectado a ${pipePath}`);
				this.clients.set(clientKey, client);
				resolve(client);
			});

			client.on("error", reject);
		});
	}

	/**
	 * Envía una llamada a método remoto mediante IPC
	 */
	async call(moduleName: string, moduleVersion: string, language: string, method: string, args: any[]): Promise<any> {
		const client = await this.getOrCreateClient(moduleName, moduleVersion, language);

		// Serializar buffers en los argumentos
		const serializedArgs = args.map((arg) => {
			if (Buffer.isBuffer(arg)) {
				return { __type: "Buffer", data: arg.toString("base64") };
			}
			return arg;
		});

		const messageId = `${Date.now()}-${crypto.randomBytes(6).toString("base64url").slice(2, 9)}`;
		const message: IPCMessage = {
			id: messageId,
			type: "request",
			method,
			args: serializedArgs,
		};

		return new Promise((resolve, reject) => {
			// Registrar la solicitud pendiente
			this.pendingRequests.set(messageId, { resolve, reject });

			// Enviar el mensaje
			client.write(JSON.stringify(message) + "\n");

			// Timeout de 30 segundos
			setTimeout(() => {
				if (this.pendingRequests.has(messageId)) {
					this.pendingRequests.delete(messageId);
					reject(new Error(`Timeout esperando respuesta de ${moduleName}@${moduleVersion} (${language})`));
				}
			}, 30000);
		});
	}

	/**
	 * Cierra un servidor IPC
	 */
	async closeServer(moduleName: string, moduleVersion: string, language: string): Promise<void> {
		const serverKey = `${moduleName}-${moduleVersion}-${language}`;
		const server = this.servers.get(serverKey);

		if (server) {
			return new Promise((resolve) => {
				server.close(() => {
					this.servers.delete(serverKey);
					Logger.info(`[IPCManager] Servidor IPC cerrado: ${serverKey}`);
					resolve();
				});
			});
		}
	}

	/**
	 * Cierra un cliente IPC
	 */
	async closeClient(moduleName: string, moduleVersion: string, language: string): Promise<void> {
		const clientKey = `${moduleName}-${moduleVersion}-${language}`;
		const client = this.clients.get(clientKey);

		if (client) {
			client.destroy();
			this.clients.delete(clientKey);
			Logger.debug(`[IPCManager] Cliente IPC cerrado: ${clientKey}`);
		}
	}

	/**
	 * Cierra todos los servidores y clientes IPC
	 */
	async closeAll(): Promise<void> {
		const closePromises: Promise<void>[] = [];

		// Cerrar todos los servidores
		for (const [serverKey] of this.servers) {
			const [moduleName, moduleVersion, language] = serverKey.split("-");
			closePromises.push(this.closeServer(moduleName, moduleVersion, language));
		}

		// Cerrar todos los clientes
		for (const [clientKey] of this.clients) {
			const [moduleName, moduleVersion, language] = clientKey.split("-");
			closePromises.push(this.closeClient(moduleName, moduleVersion, language));
		}

		await Promise.all(closePromises);
	}
}

// Instancia singleton
export const ipcManager = new IPCManager();
