import type { IdleRunContext } from "@common/types/operations/IIdleOrchestrator.ts";
import type { AttachmentsManager } from "../../../utilities/attachments/attachments-utility/index.js";
import type { UserManager } from "./dao/index.js";
import type { UserAvatarEndpointCtx } from "./permissions/userAvatarAttachments.js";

/**
 * Ingesta **del lado del servidor** del avatar que trae una cuenta OAuth.
 *
 * Guardar la URL del CDN del proveedor obligaba al navegador de CADA visitante a pedirle la imagen
 * a un tercero (le entregaba su IP y qué página estaba mirando, en toda pantalla con avatares).
 * Acá la imagen se baja UNA vez desde el servidor, se guarda como adjunto propio y lo que se
 * persiste es siempre una URL nuestra. Si algo falla, la cuenta queda sin avatar —cae al
 * auto-avatar determinista— pero NUNCA con la URL remota: quedársela es exactamente la fuga.
 */

/**
 * Política de avatares, compartida con el `AttachmentsManager` que los guarda (una sola
 * definición: la subida manual y la ingesta aceptan lo mismo).
 */
export const AVATAR_ALLOWED_MIME_TYPES = ["image/jpeg", "image/png", "image/gif", "image/webp"] as const;
export const AVATAR_MAX_SIZE_BYTES = 2 * 1024 * 1024;

const ALLOWED_MIMES: ReadonlySet<string> = new Set(AVATAR_ALLOWED_MIME_TYPES);

/**
 * Tope propio de la ingesta, más bajo que el de una subida manual: la URL la elige un tercero, así
 * que el servidor se baja lo mínimo que necesita una foto de perfil (256×256 en PNG entra de sobra).
 */
const INGEST_MAX_BYTES = 512 * 1024;

/** Tope por petición (bajada del CDN y subida a S3). Acota lo que la ingesta demora un alta OAuth. */
const INGEST_TIMEOUT_MS = 4000;

/** CDNs de los proveedores OAuth soportados: no se baja nada de ningún otro host. */
const ALLOWED_AVATAR_HOSTS: ReadonlyArray<string | RegExp> = ["cdn.discordapp.com", /^[a-z0-9-]+\.googleusercontent\.com$/];

/** Usuarios por lote del backfill: cada uno hace una petición a un CDN externo. */
const BACKFILL_BATCH_SIZE = 20;

export interface AvatarIngestDeps {
	/** Manager interno (sin auth): la ingesta corre pre-sesión y desde trabajos de fondo. */
	users: UserManager;
	/** Getter, no instancia: el manager se rehace si S3 vuelve tras un arranque sin él. */
	attachments: () => AttachmentsManager | null;
	logger: { logInfo(msg: string): void; logWarn(msg: string): void };
}

/** Host de una URL para los logs: alcanza para diagnosticar y no arrastra el identificador remoto. */
function hostOf(url: string): string {
	try {
		return new URL(url).host;
	} catch {
		return "(url inválida)";
	}
}

/** https + host en la allowlist. Todo lo demás no se descarga. */
function isIngestableAvatarUrl(raw: string): boolean {
	let url: URL;
	try {
		url = new URL(raw);
	} catch {
		return false;
	}
	if (url.protocol !== "https:") return false;
	return ALLOWED_AVATAR_HOSTS.some((host) => (typeof host === "string" ? url.hostname === host : host.test(url.hostname)));
}

/**
 * Baja la imagen con tope de tamaño, de tiempo y de tipo.
 *
 * `redirect: "error"`: la allowlist de hosts no valdría nada si el CDN pudiera redirigirnos a
 * cualquier otra dirección (incluida una interna) y la siguiéramos.
 */
async function downloadAvatar(url: string): Promise<{ bytes: Uint8Array<ArrayBuffer>; mimeType: string }> {
	const res = await fetch(url, {
		redirect: "error",
		signal: AbortSignal.timeout(INGEST_TIMEOUT_MS),
		headers: { accept: AVATAR_ALLOWED_MIME_TYPES.join(",") },
	});
	if (!res.ok) throw new Error(`el CDN respondió ${res.status}`);

	const mimeType = (res.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
	if (!ALLOWED_MIMES.has(mimeType)) throw new Error(`tipo no permitido: ${mimeType || "(sin content-type)"}`);

	const declared = Number(res.headers.get("content-length"));
	if (Number.isFinite(declared) && declared > INGEST_MAX_BYTES) throw new Error(`declara ${declared} bytes`);
	if (!res.body) throw new Error("respuesta sin cuerpo");

	// El corte va mientras se lee: el `content-length` lo pone el mismo tercero del que
	// desconfiamos, así que puede mentir (o faltar) y el chorro ser ilimitado.
	const reader = res.body.getReader();
	const chunks: Uint8Array[] = [];
	let total = 0;
	try {
		for (;;) {
			const { done, value } = await reader.read();
			if (done) break;
			total += value.byteLength;
			if (total > INGEST_MAX_BYTES) throw new Error(`supera el tope de ${INGEST_MAX_BYTES} bytes`);
			chunks.push(value);
		}
	} finally {
		await reader.cancel().catch(() => undefined);
	}
	if (total === 0) throw new Error("imagen vacía");

	const bytes = new Uint8Array(total);
	let offset = 0;
	for (const chunk of chunks) {
		bytes.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return { bytes, mimeType };
}

/**
 * Baja el avatar remoto y lo guarda como adjunto propio (misma secuencia presign → PUT → confirm
 * que la subida manual, con el mismo contexto de permisos). Devuelve el `attachmentId`.
 */
async function storeRemoteAvatar(deps: AvatarIngestDeps, userId: string, remoteUrl: string): Promise<string> {
	if (!isIngestableAvatarUrl(remoteUrl)) throw new Error(`host no permitido: ${hostOf(remoteUrl)}`);

	const attachments = deps.attachments();
	if (!attachments) throw new Error("almacenamiento de avatares no disponible (falta S3)");

	const { bytes, mimeType } = await downloadAvatar(remoteUrl);
	// Los avatares cuentan SIEMPRE en la cuota personal, y la persona es a la vez dueña y
	// "subidora" del adjunto (lo que exige el checker de permisos para confirmar).
	const ctx: UserAvatarEndpointCtx = { userId, targetUserId: userId, orgId: null };

	const presigned = await attachments.presignUpload(ctx, {
		ownerType: "user-avatar",
		ownerId: userId,
		fileName: `provider-avatar.${mimeType.split("/")[1]}`,
		mimeType,
		size: bytes.byteLength,
		// Sin `publicHost`: quien sube es el servidor, no un navegador de la red.
	});

	const put = await fetch(presigned.uploadUrl, {
		method: "PUT",
		headers: presigned.headers,
		body: bytes,
		signal: AbortSignal.timeout(INGEST_TIMEOUT_MS),
	});
	if (!put.ok) throw new Error(`la subida a S3 respondió ${put.status}`);

	const confirmed = await attachments.confirmUpload(ctx, presigned.attachmentId);
	return confirmed.id;
}

/** `true` si la persona todavía no eligió su avatar: sólo entonces tiene sentido ingerir el del proveedor. */
async function shouldIngest(deps: AvatarIngestDeps, userId: string): Promise<boolean> {
	const user = await deps.users.getUser(userId);
	if (!user) return false;
	const meta = (user.metadata ?? {}) as { avatarSource?: unknown; customAvatar?: { attachmentId?: string } | null };
	// Elección explícita de no usar la foto del proveedor, o imagen propia ya subida: se respeta.
	if (meta.avatarSource === "none" || meta.avatarSource === "default") return false;
	return !meta.customAvatar?.attachmentId;
}

/**
 * Ingesta el avatar de un proveedor OAuth y deja apuntado el nuestro. **Nunca lanza**: un alta o
 * una vinculación no pueden fallar por una imagen, y pase lo que pase la cuenta termina sin
 * ninguna URL remota guardada.
 */
export async function ingestProviderAvatar(deps: AvatarIngestDeps, userId: string, remoteUrl?: string): Promise<boolean> {
	if (!userId) return false;

	let attachmentId: string | null = null;
	try {
		if (remoteUrl && (await shouldIngest(deps, userId))) {
			attachmentId = await storeRemoteAvatar(deps, userId, remoteUrl);
		}
	} catch (err: any) {
		deps.logger.logWarn(`[avatar] no se pudo ingerir el avatar de ${userId} desde ${hostOf(remoteUrl ?? "")}: ${err?.message || err}`);
	}

	try {
		// Va SIEMPRE, aunque la ingesta falle: quedarse con la URL del CDN es la fuga que esto viene
		// a cerrar. Sin adjunto propio, la cuenta cae al auto-avatar.
		await deps.users.clearRemoteAvatarRefs(userId, attachmentId);
	} catch (err: any) {
		deps.logger.logWarn(`[avatar] no se pudieron limpiar las URLs remotas de ${userId}: ${err?.message || err}`);
		return false;
	}
	return attachmentId !== null;
}

/**
 * Un lote del backfill de cuentas anteriores a la ingesta. No necesita cursor: cada usuario
 * procesado deja de matchear el filtro, así que el barrido se vacía solo y a partir de ahí
 * devuelve 0 (el orquestador lo va espaciando hasta dormirlo).
 */
export async function backfillRemoteAvatars(deps: AvatarIngestDeps, ctx: IdleRunContext): Promise<number> {
	const pending = await deps.users.findUsersWithRemoteAvatarPage(BACKFILL_BATCH_SIZE);
	let processed = 0;
	let ingested = 0;
	for (const { id, remoteAvatarUrl } of pending) {
		if (ctx.signal.aborted) break;
		// `ingestProviderAvatar` no lanza: un usuario problemático no puede cortar el barrido.
		if (await ingestProviderAvatar(deps, id, remoteAvatarUrl)) ingested++;
		processed++;
	}
	if (processed > 0) deps.logger.logInfo(`[avatar] backfill: ${processed} cuenta(s) sin URL remota (${ingested} con avatar ingerido)`);
	return processed;
}
