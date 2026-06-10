import type { FastifyRequest, FastifyReply } from "fastify";
import type { Request, Response, RequestHandler } from "express";
import type { ConnectRouter } from "@connectrpc/connect";

/**
 * Union types para soportar Fastify y Express nativamente
 */
export type HttpRequest = FastifyRequest | Request;
export type HttpReply = FastifyReply | Response;

/**
 * Handler genérico que funciona con Fastify o Express
 */
export type HttpHandler =
	| ((req: FastifyRequest<any>, reply: FastifyReply<any>) => void | Promise<void>)
	| RequestHandler;

/**
 * Configuración de host para routing basado en dominio/subdominio
 */
export interface HostConfig {
	/** Dominio base (ej: "local.com", "*.example.com") */
	domain: string;
	/** Lista de subdominios o comodín "*" para cualquiera */
	subdomains?: string[];
}

/**
 * Configuración de hosting para un módulo UI
 */
export interface UIHostingConfig {
	/** Configuración de hosts donde se sirve el módulo */
	hosts?: HostConfig[];
	/** Lista de subdominios como strings simples (usa dominio por defecto) */
	subdomains?: string[];
	/** Lista de dominios completos donde servir */
	domains?: string[];
}

/**
 * Interface para el provider de servidor HTTP
 */
export interface IHttpServerProvider {
	/**
	 * Registra una ruta con un método HTTP específico
	 */
	registerRoute(method: string, path: string, handler: HttpHandler): void;

	/**
	 * Sirve archivos estáticos desde un directorio
	 */
	serveStatic(path: string, directory: string): void;

	/**
	 * Inicia el servidor en un puerto específico
	 */
	listen(port: number): Promise<void>;
}

/**
 * Interface extendida para servidor HTTP con soporte de host-based routing
 */
export interface IHostBasedHttpProvider extends IHttpServerProvider {
	/**
	 * Registra un host virtual con su directorio de archivos estáticos
	 * @param hostPattern Patrón de host (ej: "*.local.com", "cloud.local.com")
	 * @param directory Directorio de archivos a servir
	 * @param options Opciones adicionales (fallback a index.html, etc)
	 */
	registerHost(hostPattern: string, directory: string, options?: HostOptions): void;

	/**
	 * Registra una ruta específica para un host
	 */
	registerHostRoute(hostPattern: string, method: string, path: string, handler: HttpHandler): void;

	/**
	 * Obtiene la lista de hosts registrados
	 */
	getRegisteredHosts(): string[];

	/**
	 * Verifica si el servidor soporta host-based routing
	 */
	supportsHostRouting(): boolean;

	/**
	 * Registra rutas Connect RPC
	 * @param routes Función que define las rutas Connect RPC
	 * @param options Opciones para Connect RPC
	 */
	registerConnectRPC(routes: (router: ConnectRouter) => void, options?: { prefix?: string }): Promise<void>;

	/**
	 * Registra la documentación interactiva de la API (Swagger UI) en `/api/docs`.
	 * @param getDocument Función que devuelve el documento OpenAPI actual (se evalúa por request)
	 */
	registerApiDocs?(getDocument: () => Record<string, unknown>): Promise<void>;
}

export interface HostOptions {
	/** Fallback a index.html para SPA routing */
	spaFallback?: boolean;
	/** Prioridad del host (mayor = más prioritario, comodines tienen menor) */
	priority?: number;
	/** Headers adicionales para las respuestas */
	headers?: Record<string, string>;
}

/**
 * Re-exportar tipos de Express para compatibilidad
 */
export type { Request, Response, RequestHandler };

/**
 * Re-exportar tipos de Fastify
 */
export type { FastifyRequest, FastifyReply };
