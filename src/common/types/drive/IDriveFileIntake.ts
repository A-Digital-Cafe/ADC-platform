import type { CapabilityToken } from "@common/security/Capability.ts";

/** Archivo que otro módulo deposita en el Drive de un usuario. El binario viaja en memoria. */
export interface DriveIntakeFile {
	fileName: string;
	mimeType: string;
	content: Buffer;
}

/** Dónde quedó el archivo. `url` es relativa a la plataforma, para enlazarla desde otra app. */
export interface DriveIntakeResult {
	fileId: string;
	folderId: string;
	fileName: string;
	size: number;
	url: string;
}

/**
 * Entrada de archivos desde otro módulo.
 *
 * Existe para el caso del correo entrante cuyo adjunto no entra en la cuota del buzón: en vez de
 * rebotar el correo, el archivo va al Drive del titular y el mensaje lleva el enlace.
 *
 * La carpeta se referencia **por nombre** y se crea si no está: quien la borre no rompe nada, la
 * próxima entrega la vuelve a crear.
 */
export interface IDriveFileIntake {
	saveIncomingFile(
		cap: CapabilityToken,
		input: { ownerId: string; orgId: string | null; folderName: string; file: DriveIntakeFile }
	): Promise<DriveIntakeResult>;
}
