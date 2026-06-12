import { Type } from "@sinclair/typebox";

/** Schemas TypeBox para los endpoints OAuth de SessionManagerService. */

export const ProviderParams = Type.Object({
	provider: Type.String({ minLength: 1, description: "Proveedor OAuth (platform, discord, …)" }),
});

export const OAuthLoginQuery = Type.Object({
	returnUrl: Type.Optional(Type.String({ description: "URL de retorno tras la autenticación" })),
});

export const LinkAccountBody = Type.Object({
	password: Type.String({ minLength: 1, description: "Contraseña del usuario existente a vincular" }),
});
