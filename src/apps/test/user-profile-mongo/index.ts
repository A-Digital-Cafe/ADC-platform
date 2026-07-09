import { BaseApp } from "../../BaseApp.js";
import type { IIdentityManagerService } from "@common/types/identity/IIdentityManagerService.js";
import { AuthorizationError } from "@common/types/custom-errors/AuthorizationError.js";
import type { Role, User } from "@common/types/identity/index.js";
import type { ISessionManagerService } from "@common/types/identity/ISessionManagerService.js";
import { Logger } from "../../../utils/logger/Logger.js";
import { IdentityScopes } from "@common/types/identity/permissions.ts";
import { CRUDXAction } from "@common/types/Actions.ts";
import crypto from "node:crypto";

interface IdentityTestData {
	userIds: string[];
	roleIds: string[];
	groupIds: string[];
}

/**
 * App que prueba IIdentityManagerService con MongoDB y autenticación.
 * Prueba el flujo completo: login, tokens, permisos y operaciones autenticadas.
 *
 * Usa el usuario SYSTEM para operaciones privilegiadas.
 */
export default class UserProfileApp extends BaseApp {
	private identityManager!: IIdentityManagerService;
	private sessionManager!: ISessionManagerService;
	#systemUser: User | null = null;
	#systemToken: string | null = null;
	private testData: IdentityTestData = {
		userIds: [],
		roleIds: [],
		groupIds: [],
	};

	async start(kernelKey: symbol) {
		await super.start(kernelKey);
		this.identityManager = this.getMyService<IIdentityManagerService>("IdentityManagerService");
		this.sessionManager = this.getMyService<ISessionManagerService>("SessionManagerService");
		// Capability del app (scopes `identity:system` + `session:programmatic`, declarados en default.json).
		this.#systemUser = await this.identityManager.system.getSystemUser(this.getCapability());
	}

	async stop() {
		Logger.info(`\n[${this.name}] =============== LIMPIANDO RECURSOS ===============`);
		if (!this.identityManager) {
			Logger.warn(`[${this.name}] IdentityManager no disponible, no se puede limpiar.`);
			return;
		}

		try {
			const token = await this.#getSystemToken();

			// Borrar usuarios (en orden inverso para evitar dependencias)
			for (const userId of [...this.testData.userIds].reverse()) {
				try {
					await this.identityManager.users.deleteUser(userId, token);
					Logger.ok(`[${this.name}] ✓ Usuario eliminado: ${userId}`);
				} catch (e: any) {
					Logger.warn(`[${this.name}] No se pudo eliminar usuario ${userId}: ${e.message}`);
				}
			}

			// Borrar grupos
			for (const groupId of this.testData.groupIds) {
				try {
					await this.identityManager.groups.deleteGroup(groupId, token);
					Logger.ok(`[${this.name}] ✓ Grupo eliminado: ${groupId}`);
				} catch (e: any) {
					Logger.warn(`[${this.name}] No se pudo eliminar grupo ${groupId}: ${e.message}`);
				}
			}

			// Borrar roles
			for (const roleId of this.testData.roleIds) {
				try {
					await this.identityManager.roles.deleteRole(roleId, token);
					Logger.ok(`[${this.name}] ✓ Rol eliminado: ${roleId}`);
				} catch (e: any) {
					Logger.warn(`[${this.name}] No se pudo eliminar rol ${roleId}: ${e.message}`);
				}
			}

			this.testData = { userIds: [], roleIds: [], groupIds: [] };
			Logger.ok(`[${this.name}] =============== LIMPIEZA COMPLETADA ===============\n`);
		} catch (error: any) {
			Logger.error(`[${this.name}] Error durante la limpieza: ${error.message}`);
		}
	}

	async run(): Promise<void> {
		Logger.info(`\n[${this.name}] =============== INICIANDO PRUEBAS ===============`);

		try {
			if (!this.identityManager) {
				Logger.warn(`[${this.name}] IdentityManager no disponible, saltando pruebas`);
				return;
			}

			// Test básico sin autenticación
			await this.#testBasicOperations();

			// Test con autenticación y permisos (solo si SessionManager está disponible)
			if (this.sessionManager) {
				await this.#testAuthenticatedOperations();
			} else {
				Logger.warn(`[${this.name}] SessionManager no disponible, saltando pruebas de auth`);
			}

			Logger.ok(`[${this.name}] =============== PRUEBAS COMPLETADAS ===============\n`);
		} catch (error: any) {
			Logger.error(`[${this.name}] Error durante la ejecución: ${error.message}`);
			Logger.error(error.stack);
		}
	}

	/**
	 * Prueba operaciones con token SYSTEM
	 */
	async #testBasicOperations(): Promise<void> {
		const token = await this.#getSystemToken();
		Logger.info(`\n[${this.name}] --- Test: Operaciones Básicas (con token SYSTEM) ---`);

		// 1. Crear rol de prueba
		const role = await this.#createTestRole("basic", token);
		this.testData.roleIds.push(role.id);
		Logger.ok(`[${this.name}] ✓ Rol creado: ${role.name}`);

		// 2. Crear grupo
		const group = await this.identityManager.groups.createGroup(`test-group-${Date.now()}`, "Grupo de prueba básico", [role.id], token);
		this.testData.groupIds.push(group.id);
		Logger.ok(`[${this.name}] ✓ Grupo creado: ${group.name}`);

		// 3. Crear usuario
		const user = await this.identityManager.users.createUser(`test-user-${Date.now()}`, `pwd-${crypto.randomUUID()}`, [role.id], token);
		this.testData.userIds.push(user.id);
		Logger.ok(`[${this.name}] ✓ Usuario creado: ${user.username}`);

		// 4. Asociar usuario con grupo
		await this.identityManager.groups.addUserToGroup(user.id, group.id, token);
		Logger.ok(`[${this.name}] ✓ Usuario asociado al grupo`);

		// 5. Verificar permisos
		const hasReadPerm = await this.identityManager.permissions.hasPermission(user.id, CRUDXAction.READ, IdentityScopes.SELF);
		Logger.info(`[${this.name}]   Usuario tiene permiso READ.SELF: ${hasReadPerm}`);

		// 6. Estadísticas
		const stats = await this.identityManager.getStats(token);
		Logger.info(`[${this.name}] Estadísticas:`);
		Logger.info(`  - Usuarios: ${stats.totalUsers}, Roles: ${stats.totalRoles}, Grupos: ${stats.totalGroups}`);

		Logger.ok(`[${this.name}] ✓ Test básico completado`);
	}

	/**
	 * Prueba operaciones con autenticación y verificación de permisos
	 * Usa el usuario SYSTEM que tiene todos los permisos
	 */
	async #testAuthenticatedOperations(): Promise<void> {
		Logger.info(`\n[${this.name}] --- Test: Operaciones Autenticadas (con token) ---`);

		// 1. Obtener el usuario SYSTEM y sus credenciales (requiere capability `identity:system`)
		Logger.ok(`[${this.name}] ✓ Usuario SYSTEM obtenido: ${this.#systemUser!.username}`);

		// 2. Hacer login del SYSTEM usando sus credenciales reales
		// Las credenciales solo son accesibles con capability `identity:system` (seguro)
		const systemCredentials = this.identityManager.system.getSystemCredentials(this.getCapability());
		const systemToken = await this.sessionManager.loginProgrammatic(this.getCapability(), systemCredentials.username, systemCredentials.password);
		if (!systemToken) {
			throw new Error("No se pudo obtener token para usuario SYSTEM");
		}
		Logger.ok(`[${this.name}] ✓ Token SYSTEM generado via login real`);

		// 3. Crear rol con permisos limitados (solo lectura)
		const limitedRole = await this.identityManager.roles.createRole(
			`limited-role-${Date.now()}`,
			"Rol con permisos limitados",
			[{ resource: "identity", action: CRUDXAction.READ, scope: IdentityScopes.USERS }],
			systemToken
		);
		this.testData.roleIds.push(limitedRole.id);
		Logger.ok(`[${this.name}] ✓ Rol limitado creado: ${limitedRole.name}`);

		// 4. Crear usuario con permisos limitados
		const limitedPassword = `limited-pwd-${crypto.randomUUID()}`;
		const limitedUser = await this.identityManager.users.createUser(`limited-${Date.now()}`, limitedPassword, [limitedRole.id], systemToken);
		this.testData.userIds.push(limitedUser.id);
		Logger.ok(`[${this.name}] ✓ Usuario limitado creado: ${limitedUser.username}`);

		// 5. Hacer login del usuario limitado usando sus credenciales reales
		const limitedToken = await this.sessionManager.loginProgrammatic(this.getCapability(), limitedUser.username, limitedPassword);
		if (!limitedToken) {
			throw new Error("No se pudo obtener token para usuario limitado");
		}
		Logger.ok(`[${this.name}] ✓ Token limitado generado via login real`);

		// 6. Test: SYSTEM puede crear usuarios pasando token como parámetro
		Logger.info(`[${this.name}] Probando operaciones con token SYSTEM...`);
		try {
			const newUser = await this.identityManager.users.createUser(
				`created-by-system-${Date.now()}`,
				"temp-password",
				[],
				systemToken // Token como último parámetro
			);
			this.testData.userIds.push(newUser.id);
			Logger.ok(`[${this.name}] ✓ SYSTEM pudo crear usuario: ${newUser.username}`);

			// SYSTEM puede leer usuarios
			const { total: totalUsers } = await this.identityManager.users.getAllUsers(systemToken);
			Logger.ok(`[${this.name}] ✓ SYSTEM pudo listar ${totalUsers} usuarios`);
		} catch (error: any) {
			Logger.error(`[${this.name}] ✗ Error con token SYSTEM: ${error.message}`);
		}

		// 7. Test: Usuario limitado puede leer pero NO puede crear
		Logger.info(`[${this.name}] Probando restricciones con token limitado...`);
		try {
			// Usuario limitado puede leer (tiene permiso READ)
			const { total: readableUsers } = await this.identityManager.users.getAllUsers(limitedToken);
			Logger.ok(`[${this.name}] ✓ Usuario limitado pudo listar ${readableUsers} usuarios (tiene READ)`);

			// Usuario limitado NO puede crear (no tiene permiso WRITE)
			try {
				await this.identityManager.users.createUser(`should-fail-${Date.now()}`, "temp", [], limitedToken);
				Logger.error(`[${this.name}] ✗ Usuario limitado pudo crear (NO debería poder)`);
			} catch (authError: any) {
				if (authError instanceof AuthorizationError) {
					Logger.ok(`[${this.name}] ✓ Usuario limitado bloqueado correctamente para WRITE: ${authError.errorKey}`);
				} else {
					throw authError;
				}
			}

			// Usuario limitado NO puede eliminar
			try {
				await this.identityManager.users.deleteUser(limitedUser.id, limitedToken);
				Logger.error(`[${this.name}] ✗ Usuario limitado pudo eliminar (NO debería poder)`);
			} catch (authError: any) {
				if (authError instanceof AuthorizationError) {
					Logger.ok(`[${this.name}] ✓ Usuario limitado bloqueado correctamente para DELETE: ${authError.errorKey}`);
				} else {
					throw authError;
				}
			}
		} catch (error: any) {
			if (error instanceof AuthorizationError) {
				Logger.ok(`[${this.name}] ✓ Operación bloqueada correctamente: ${error.message}`);
			} else {
				Logger.error(`[${this.name}] ✗ Error inesperado: ${error.message}`);
				Logger.error(error.stack);
			}
		}

		// 8. Test: Token inválido debe fallar
		Logger.info(`[${this.name}] Probando token inválido...`);
		try {
			await this.identityManager.users.getAllUsers("invalid-token-12345");
			Logger.error(`[${this.name}] ✗ Token inválido fue aceptado (NO debería)`);
		} catch (error: any) {
			if (error instanceof AuthorizationError) {
				Logger.ok(`[${this.name}] ✓ Token inválido rechazado correctamente: ${error.errorKey}`);
			} else {
				Logger.ok(`[${this.name}] ✓ Token inválido rechazado: ${error.message}`);
			}
		}

		Logger.ok(`[${this.name}] ✓ Test de autenticación completado`);
	}

	/**
	 * Obtiene o reutiliza el token SYSTEM
	 */
	async #getSystemToken(): Promise<string> {
		if (this.#systemToken) return this.#systemToken;

		const systemCredentials = this.identityManager.system.getSystemCredentials(this.getCapability());
		const token = await this.sessionManager.loginProgrammatic(this.getCapability(), systemCredentials.username, systemCredentials.password);
		if (!token) {
			throw new Error("No se pudo obtener token para usuario SYSTEM");
		}
		this.#systemToken = token;
		return token;
	}

	/**
	 * Crea un rol de prueba con permisos básicos
	 */
	async #createTestRole(prefix: string, token: string): Promise<Role> {
		return await this.identityManager.roles.createRole(
			`${prefix}-role-${Date.now()}`,
			`Rol de prueba ${prefix}`,
			[
				{ resource: "user-profile", action: CRUDXAction.READ, scope: IdentityScopes.SELF },
				{ resource: "user-profile", action: CRUDXAction.WRITE, scope: IdentityScopes.SELF },
			],
			token
		);
	}
}
