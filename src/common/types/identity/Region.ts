/**
 * Metadata de región (extensible).
 *
 * Una región describe el backend de datos de una organización, no un nodo del kernel: lo único
 * que declara es a qué Mongo van sus colecciones. No hay un URI de caché por región a propósito
 * — Redis en esta plataforma se reparte por SITIO (latencia), no por organización.
 */
export interface RegionMetadata {
	objectConnectionUri?: string;
	[key: string]: any;
}

/**
 * Información de región
 */
export interface RegionInfo {
	path: string;
	isGlobal: boolean;
	isActive: boolean;
	metadata: RegionMetadata;
	createdAt: Date;
	updatedAt: Date;
}
