/**
 * Schema TypeBox del `AttachmentDTO` canónico (`@common/types/attachments/Attachment.ts`).
 *
 * Existe porque los servicios que exponen adjuntos (project-management, content-service,
 * EmailService) lo tenían re-declarado a mano, y las copias ya habían divergido: dos de
 * ellas marcaban **todo** opcional y omitían `uploadedBy`, así que —al ser este schema
 * también el serializador de respuesta de Fastify— el campo se borraba de cada respuesta
 * aunque `AttachmentsManager.toDto()` lo devolviera. Es el único productor del DTO, de modo
 * que un solo schema describe a los tres.
 *
 * La aserción `Static<...> === AttachmentDTO` de abajo es lo que mantiene el schema y la
 * interfaz atados: agregar un campo al DTO sin agregarlo acá no compila.
 */
import { Type, type Static } from "@sinclair/typebox";
import type { AttachmentDTO } from "../types/attachments/Attachment.ts";

/** @public */
export const AttachmentDtoSchema = Type.Object(
	{
		id: Type.String(),
		fileName: Type.String(),
		mimeType: Type.String(),
		size: Type.Integer(),
		status: Type.Union([Type.Literal("pending"), Type.Literal("ready"), Type.Literal("retained")], {
			description: "pending = presignado sin confirmar; ready = disponible; retained = en retención legal",
		}),
		uploadedBy: Type.String({ description: "userId que subió el adjunto" }),
		uploadedAt: Type.Optional(Type.String({ format: "date-time" })),
		createdAt: Type.String({ format: "date-time" }),
	},
	{ $id: "AttachmentDto", description: "Adjunto (vista pública: sin `bucket` ni `storageKey`)" }
);

/** Falla el typecheck si el schema y {@link AttachmentDTO} se separan. */
type SchemaMatchesDto = Static<typeof AttachmentDtoSchema> extends AttachmentDTO
	? AttachmentDTO extends Static<typeof AttachmentDtoSchema>
		? true
		: never
	: never;
const _schemaMatchesDto: SchemaMatchesDto = true;
void _schemaMatchesDto;
