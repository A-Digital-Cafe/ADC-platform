import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type MongoProvider from "@providers/object/mongo/index.js";
import { BaseService } from "@services/BaseService.js";
import { Kernel } from "@kernel";
import { installPlatformSettings, updatePlatformSetting } from "@common/utils/platform-settings.ts";
import type { IPlatformSettingsService, PlatformSettingEntry } from "@common/types/platform/IPlatformSettingsService.ts";
import { HttpError } from "@common/types/ADCCustomError.ts";
import { getOrCreateSettingsModel, loadAndSeed, type PlatformSettingDoc, type SettingDefault } from "./dao/settings.ts";

/**
 * Configuración del CLÚSTER, guardada en Mongo y no en el `env/` de cada máquina.
 *
 * Retenciones, ventanas de los barridos, límites de cuerpo y de caudal, URLs de confirmación y el
 * despliegue desde GitHub: nada de eso describe a una máquina, y repartirlo en un archivo por nodo
 * sólo garantizaba que alguna quedara distinta sin que nadie se enterara.
 *
 * `kernelMode 5` porque estos valores los consumen módulos que se cargan después: el límite de
 * cuerpo lo lee el servidor HTTP al construirse (`kernelMode 40`) y el resto se interpola en los
 * `config.json` al cargarlos. Por eso mismo **no declara `EndpointManagerService`** —arrastraría el
 * servidor HTTP a cargarse antes de este `start()`— y en consecuencia no expone API: la
 * configuración se edita en la colección `platform_settings`.
 *
 * Con Mongo caído degrada (`failOnError: false`): sin mapa instalado cada valor cae al entorno o al
 * default del `config.json`, con un warning ruidoso.
 */
export default class PlatformSettingsService extends BaseService implements IPlatformSettingsService {
	public readonly name = "PlatformSettingsService";

	private mongoProvider!: MongoProvider;
	/** Lo que se puede configurar. Es además la lista blanca de `setSetting`. */
	#defaults: Record<string, SettingDefault> = {};
	#model: ReturnType<typeof getOrCreateSettingsModel> | null = null;

	constructor(kernel: Kernel, options?: any) {
		super(kernel, options);
	}

	async start(kernelKey: symbol): Promise<void> {
		await super.start(kernelKey);

		this.mongoProvider = this.getMyProvider<MongoProvider>("object/mongo");
		await this.waitForProvider(this.mongoProvider, "MongoDB");

		const defaults = this.#readDefaults();
		this.#defaults = defaults;
		try {
			const model = getOrCreateSettingsModel(this.mongoProvider.getConnection());
			this.#model = model;
			// La única lectura de `process.env` del servicio, y es para MIGRAR: si la variable todavía
			// está en el `env/` de este nodo, su valor es el que se siembra.
			const result = await loadAndSeed(model, defaults, (name) => process.env[name]);
			installPlatformSettings(result.values);

			const fromEnv = result.seeded.filter((s) => s.from === "env").map((s) => s.name);
			this.logger.logOk(
				`[settings] ${Object.keys(result.values).length} opciones de plataforma cargadas desde la base` +
					(result.seeded.length > 0 ? ` (${result.seeded.length} sembradas${fromEnv.length > 0 ? `, ${fromEnv.length} tomadas del entorno` : ""})` : "")
			);
			if (fromEnv.length > 0) {
				this.logger.logInfo(`[settings] migradas desde el entorno: ${fromEnv.join(", ")}. Ya se pueden borrar de env/.`);
			}
			// Que una variable de entorno quede ignorada tiene que verse: es la confusión más cara de
			// esta arquitectura —alguien edita el archivo, reinicia y no cambia nada—.
			if (result.shadowedEnv.length > 0) {
				this.logger.logWarn(
					`[settings] estas variables siguen definidas en el entorno pero manda la base: ${result.shadowedEnv.join(", ")}. ` +
						"Cambiarlas en `env/` no tiene efecto; se cambian en la colección `platform_settings`."
				);
			}
		} catch (error) {
			this.logger.logWarn(
				`[settings] no se pudo leer la configuración de plataforma (${(error as Error).message}). ` +
					"Cada módulo va a usar su default: si este nodo tenía retenciones o límites distintos de los del clúster, esta vez no los aplica."
			);
		}
	}

	/**
	 * Qué se puede configurar y con qué valor está hoy. Lee la base y no la copia en memoria: quien
	 * abre la pantalla quiere ver lo que hay guardado, incluido lo que cambió otro nodo.
	 */
	async listSettings(): Promise<PlatformSettingEntry[]> {
		const stored = new Map<string, PlatformSettingDoc>();
		if (this.#model) {
			for (const doc of await this.#model.find({}).lean<PlatformSettingDoc[]>()) stored.set(doc._id, doc);
		}
		return Object.entries(this.#defaults).map(([name, def]) => {
			const doc = stored.get(name);
			return {
				name,
				value: doc?.value ?? def.value,
				group: def.group,
				help: def.help,
				updatedAt: doc?.updatedAt ? new Date(doc.updatedAt).toISOString() : null,
				updatedBy: doc?.updatedBy ?? null,
			};
		});
	}

	/**
	 * Cambia una opción. La lista blanca es `defaults.json`: un nombre que no esté ahí se rechaza,
	 * porque estos valores se interpolan dentro de los `config.json` de todos los módulos y sembrar
	 * claves arbitrarias sería inyectar configuración en cualquiera de ellos.
	 *
	 * Deja el valor nuevo en la copia en memoria de este proceso; los demás nodos lo toman al
	 * arrancar. Aplicarlo en caliente en todo el clúster es de quien lo cambia.
	 */
	async setSetting(name: string, value: string, actor: string | undefined): Promise<void> {
		if (!this.#defaults[name]) {
			throw new HttpError(400, "UNKNOWN_SETTING", `'${name}' no es una opción de plataforma declarada.`);
		}
		if (!this.#model) {
			throw new HttpError(503, "SETTINGS_UNAVAILABLE", "La configuración de plataforma no está disponible: no se pudo leer la base al arrancar.");
		}
		await this.#model.updateOne({ _id: name }, { $set: { value, updatedAt: new Date(), updatedBy: actor ?? "desconocido" } }, { upsert: true });
		updatePlatformSetting(name, value);
		this.logger.logWarn(`[settings] '${name}' cambiada por '${actor ?? "desconocido"}'.`);
	}

	/**
	 * Los defaults viven en un JSON al lado y no en el código para poder leerlos —y diffearlos— sin
	 * abrir un `.ts`: son la lista de qué se puede configurar.
	 */
	#readDefaults(): Record<string, SettingDefault> {
		const path = join(dirname(fileURLToPath(import.meta.url)), "defaults.json");
		try {
			const raw = JSON.parse(readFileSync(path, "utf8")) as Record<string, SettingDefault | string>;
			const out: Record<string, SettingDefault> = {};
			for (const [name, def] of Object.entries(raw)) {
				// `_readme` explica el archivo dentro del propio archivo, ya que JSON no tiene comentarios.
				if (name.startsWith("_") || typeof def === "string") continue;
				out[name] = def;
			}
			return out;
		} catch (error) {
			this.logger.logWarn(`[settings] no se pudo leer defaults.json (${(error as Error).message}): no se siembra nada.`);
			return {};
		}
	}
}
