import { Schema, type Connection, type Model } from "mongoose";

/**
 * Una opción de plataforma. El nombre es la clave: no hay ids sintéticos, porque el nombre ya es
 * único y es lo que se busca.
 */
export interface PlatformSettingDoc {
	_id: string;
	value: string;
	updatedAt: Date;
	/** Quién la cambió por última vez, o `seed` si la puso el arranque. */
	updatedBy: string;
}

const settingSchema = new Schema<PlatformSettingDoc>(
	{
		_id: { type: String, required: true },
		// Siempre string: es lo que la interpolación de `${VAR}` pone en un `config.json`, y guardar
		// números o booleanos tipados obligaría a que cada consumidor adivine el tipo que le tocó.
		value: { type: String, required: true, default: "" },
		updatedAt: { type: Date, required: true, default: Date.now },
		updatedBy: { type: String, required: true, default: "seed" },
	},
	{ versionKey: false, _id: false, collection: "platform_settings" }
);

export function getOrCreateSettingsModel(connection: Connection): Model<PlatformSettingDoc> {
	const existing = connection.models.PlatformSetting as Model<PlatformSettingDoc> | undefined;
	return existing ?? connection.model<PlatformSettingDoc>("PlatformSetting", settingSchema);
}

/** Lo que declara `defaults.json` para una opción. */
export interface SettingDefault {
	value: string;
	group: string;
	help: string;
}

export interface SeedResult {
	values: Record<string, string>;
	/** Opciones creadas en esta pasada, con de dónde salió el valor. */
	seeded: Array<{ name: string; from: "env" | "default" }>;
	/** Opciones cuyo valor de la base difiere de una variable de entorno todavía definida. */
	shadowedEnv: string[];
}

/**
 * Lee la configuración y siembra lo que falte. Es la única escritura automática que hace el
 * servicio, y sólo crea: **nunca pisa** un documento existente.
 *
 * El orden de la siembra —entorno primero, `defaults.json` después— es lo que hace que mudar una
 * variable desde `env/` no pierda su valor: si el despliegue todavía la tiene puesta, ese es el
 * valor que queda guardado. El día que se borre del `env/`, la base ya lo tiene.
 */
export async function loadAndSeed(
	model: Model<PlatformSettingDoc>,
	defaults: Record<string, SettingDefault>,
	envValue: (name: string) => string | undefined
): Promise<SeedResult> {
	const stored = await model.find({}).lean<PlatformSettingDoc[]>();
	const values: Record<string, string> = {};
	for (const doc of stored) values[doc._id] = doc.value;

	const seeded: SeedResult["seeded"] = [];
	const pending: PlatformSettingDoc[] = [];
	const now = new Date();
	for (const [name, def] of Object.entries(defaults)) {
		const fromEnv = envValue(name);
		// Un documento con valor VACÍO cuenta como "sin configurar": es el caso del instalador de
		// presets, que escribe el client ID de GitHub en `env/` mucho después del primer arranque. Sin
		// esta salvedad, ese valor quedaría ignorado para siempre por un documento que nadie llenó.
		const stored = values[name];
		if (stored !== undefined && !(stored === "" && fromEnv)) continue;
		const value = fromEnv !== undefined && fromEnv !== "" ? fromEnv : def.value;
		values[name] = value;
		seeded.push({ name, from: fromEnv !== undefined && fromEnv !== "" ? "env" : "default" });
		pending.push({ _id: name, value, updatedAt: now, updatedBy: "seed" });
	}
	if (pending.length > 0) {
		// `upsert` uno por uno y no `insertMany`: la lista incluye tanto altas como el relleno de un
		// documento vacío, y dos nodos arrancando a la vez siembran lo mismo — el que pierde la
		// carrera escribe el mismo valor, así que no hay conflicto que resolver.
		await Promise.all(
			pending.map((doc) =>
				model
					.updateOne({ _id: doc._id }, { $set: { value: doc.value, updatedAt: doc.updatedAt, updatedBy: doc.updatedBy } }, { upsert: true })
					.catch(() => undefined)
			)
		);
	}

	const shadowedEnv = Object.keys(values).filter((name) => {
		const fromEnv = envValue(name);
		return fromEnv !== undefined && fromEnv !== "" && fromEnv !== values[name];
	});

	return { values, seeded, shadowedEnv };
}
