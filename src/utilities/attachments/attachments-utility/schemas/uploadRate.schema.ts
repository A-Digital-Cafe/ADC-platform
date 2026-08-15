import { Schema, type Connection, type Model } from "mongoose";

/**
 * Bytes subidos por sujeto y por hora, para el tope de caudal.
 *
 * Colección propia y no una suma sobre los adjuntos, que sería exacta y gratis hasta que alguien
 * **borra** lo que subió y el presupuesto se restablece: acá el contador sólo sube y lo baja el
 * reloj. Un balde por hora en vez de una ventana deslizante, que exigiría guardar cada subida y
 * recorrerla; el presupuesto se renueva de golpe al cambiar de hora, sin consecuencias para un tope
 * anti-abuso. Los documentos los barre solos el índice TTL.
 */
export interface UploadRateDoc {
	/** `<userId>|<orgId|_>|<appId>|<horaEpoch>`. La clave lleva todo: no hace falta índice compuesto. */
	_id: string;
	bytes: number;
	/** Cuándo deja de contar. Lo mira el índice TTL, nadie más. */
	expiresAt: Date;
}

const uploadRateSchema = new Schema<UploadRateDoc>(
	{
		_id: { type: String, required: true },
		bytes: { type: Number, required: true, default: 0 },
		expiresAt: { type: Date, required: true },
	},
	{ versionKey: false, _id: false }
);

// `expireAfterSeconds: 0` = borrar cuando `expiresAt` quede en el pasado. El barrido de Mongo corre
// cada 60 s, así que un balde puede sobrevivir un minuto de más: irrelevante para un tope horario.
uploadRateSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

/**
 * Modelo del contador, sobre la misma conexión que los adjuntos. Se reusa el ya registrado porque
 * registrarlo dos veces sobre una conexión lanza, y lo pide un manager de los seis del proceso.
 */
export function getOrCreateUploadRateModel(connection: Connection, collectionName: string): Model<UploadRateDoc> {
	const modelName = `UploadRate_${collectionName}`;
	const existing = connection.models[modelName] as Model<UploadRateDoc> | undefined;
	if (existing) return existing;
	const schema = uploadRateSchema.clone();
	schema.set("collection", collectionName);
	return connection.model<UploadRateDoc>(modelName, schema);
}

/** Identificador del balde de esta hora para un sujeto y una app. */
export function rateBucketId(userId: string, orgId: string | null, appId: string, at: Date): string {
	const hour = Math.floor(at.getTime() / 3_600_000);
	return `${userId}|${orgId ?? "_"}|${appId}|${hour}`;
}
