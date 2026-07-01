import { ILifecycle } from "../behaviours/ILifecycle.d.ts";

/**
 * Configuración de un módulo específico (Service, Provider, Utility).
 * Corresponde al `config.json` de un módulo, o una entrada en las listas `providers`/`utilities`.
 */
export interface IModuleConfig {
	/** Nombre del módulo */
	name: string;
	/** Tipo de módulo (service, provider, utility) */
	type?: string;
	/**
	 * Nombre amigable para la status page pública. Los módulos que comparten `uiName`
	 * forman un grupo de disponibilidad (frente = apps, back = services). Sin `uiName`
	 * el módulo es interno y no aparece en la status page. Las apps lo declaran dentro
	 * de `uiModule`; el resto de capas, en la raíz del config.
	 */
	uiName?: string;
	/** Versión a cargar - puede ser exacta (1.0.0) o con rango (^1.0.0, >=1.0.0) */
	version?: string;
	/** Si es `true`, la configuración del módulo se considerará global y estará disponible en submódulos */
	global?: boolean;
	/** Lenguaje del módulo (default: 'typescript') */
	language?: string;
	/** Configuración personalizada para pasar al constructor del módulo */
	custom?: Record<string, any>;
	/**
	 * Configuración privada que se pasa al módulo pero NO afecta su uniqueKey.
	 * Útil para credenciales, secretos, o config que no debería diferenciar instancias.
	 */
	private?: Record<string, any>;
	/** Providers que este módulo necesita como dependencias */
	providers?: IModuleConfig[];
	/** Utilities que este módulo necesita como dependencias */
	utilities?: IModuleConfig[];
	/** Si true, los errores al cargar módulos no detendrán la app */
	failOnError?: boolean;

	/**
	 * Privilegios extra solicitados por el módulo, además de los defaults de su tier.
	 * Son valores del enum `Scope` (`@common/security/Capability`) como strings (vienen
	 * de `config.json`); se validan en runtime y NUNCA conceden scopes de infraestructura
	 * (`registry:write`, `module:loader`). Ej.: `["orchestrator","http:raw"]`.
	 */
	privileges?: string[];

	/**
	 * Permite propiedades adicionales.
	 * Ej: metadatos internos (__modulePath) o propiedades específicas de configuración.
	 */
	[key: string]: any;
}

export interface IModule extends ILifecycle {
	readonly name: string;
}
