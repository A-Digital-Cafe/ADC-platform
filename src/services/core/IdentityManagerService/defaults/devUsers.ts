import { SystemRole } from "./systemRoles.ts";

/**
 * Definición de un usuario de prueba sembrado SOLO en `NODE_ENV=development`.
 * Para sumar un usuario de dev con roles concretos, agregá una entrada a
 * {@link DEV_USERS}: el seeder (ver `dao/devSeeder.ts`) lo crea/actualiza en
 * cada arranque de forma idempotente. La contraseña NO vive acá: la resuelve
 * el seeder desde `private.devUserPasswords` del config.json del servicio
 * (interpolada de env vars `DEV_USER_PASSWORD_*`, ver `.env.example`).
 */
export interface DevUserSeed {
	/** Nombre de login (clave en `private.devUserPasswords`). */
	username: string;
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
	{ username: "devadmin", globalRoles: [SystemRole.ADMIN] },
	// Admin de organización: rol Admin dentro de la organización de desarrollo.
	{ username: "devorgadmin", orgRoles: [SystemRole.ADMIN] },
	// Gestores globales SIN Admin: para probar los gates por permiso de cada rol
	// (Data Manager: storage/drive.recover/email; Security Manager: identity + security).
	{ username: "devdatamanager", globalRoles: [SystemRole.DATA_MANAGER] },
	{ username: "devsecmanager", globalRoles: [SystemRole.SECURITY_MANAGER] },
];
