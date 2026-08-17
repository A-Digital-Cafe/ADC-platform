import { Type, type Static } from "@sinclair/typebox";
import { compileSchema } from "@common/utils/json-schema.ts";

/**
 * Login a medio hacer: la contraseña (o el proveedor OAuth) ya se validó, pero todavía no hay
 * sesión ni cookies. Vive en Redis —que no tiene autenticación— y sellado, así que un `SCAN` no
 * enumera logins a medio completar ni revela de quién son.
 */
const Pending2faDataSchema = Type.Object({
	userId: Type.String(),
	username: Type.String(),
	/** Contexto elegido en el login. `null` = acceso personal. */
	orgId: Type.Union([Type.String(), Type.Null()]),
	/** `"platform"` en el login nativo; el nombre del proveedor en OAuth. */
	provider: Type.String(),
	/**
	 * `verify` = la cuenta ya tiene segundo factor. `enroll` = no lo tiene y le es obligatorio
	 * (rol de administración): el login no avanza hasta que lo dé de alta ahí mismo.
	 */
	mode: Type.Union([Type.Literal("verify"), Type.Literal("enroll")]),
	/** Destino post-login, sólo en los flujos que empiezan con un redirect (OAuth). */
	returnUrl: Type.Optional(Type.String()),
});

const Pending2faEntrySchema = Type.Object({
	data: Pending2faDataSchema,
	createdAt: Type.Number(),
	expiresAt: Type.Number(),
	attempts: Type.Number(),
});

export const pending2faEntryCheck = compileSchema(Pending2faEntrySchema);

export type Pending2faData = Static<typeof Pending2faDataSchema>;
