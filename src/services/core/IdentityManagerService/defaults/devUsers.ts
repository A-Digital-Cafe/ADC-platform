import { SystemRole } from "./systemRoles.ts";

/**
 * Definición de un usuario de prueba sembrado SOLO en `NODE_ENV=development`.
 * Para sumar un usuario de dev con roles concretos, agregá una entrada a
 * {@link DEV_USERS}: el seeder (ver `dao/devSeeder.ts`) lo crea/actualiza en
 * cada arranque de forma idempotente.
 */
export interface DevUserSeed {
	/** Nombre de login. */
	username: string;
	/** Contraseña en texto plano (solo dev; queda reseteada en cada boot). */
	password: string;
	/** Email opcional (default: `${username}@dev.local`). */
	email?: string;
	/** Roles globales por nombre (se resuelven a roles con `orgId: null`). */
	globalRoles?: SystemRole[];
	/** Roles dentro de la organización de desarrollo (`orgId: DEV_ORG_ID`). */
	orgRoles?: SystemRole[];
}

/**
 * Organización de desarrollo. El `orgId` es estable e igual al slug para poder
 * loguearse pasando `orgId: "dev-org"` sin tener que descubrir un UUID generado
 * (el `PermissionManager` resuelve la org por `orgId` o `slug`, y las membresías
 * se matchean por `orgId`, así que mantenerlos iguales simplifica el login en dev).
 */
export const DEV_ORG_SLUG = "dev-org";
export const DEV_ORG_ID = DEV_ORG_SLUG;

/**
 * Usuarios de prueba para dev. Agregá entradas acá para tener más usuarios con
 * roles específicos disponibles al instante en `bun run dev`.
 */
export const DEV_USERS: DevUserSeed[] = [
	// Admin global: rol Admin global (acceso total fuera de cualquier organización).
	{ username: "devadmin", password: "devadmin123", globalRoles: [SystemRole.ADMIN] },
	// Admin de organización: rol Admin dentro de la organización de desarrollo.
	{ username: "devorgadmin", password: "devorgadmin123", orgRoles: [SystemRole.ADMIN] },
];
