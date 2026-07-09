import type { Model } from "mongoose";
import type { User } from "@common/types/identity/User.ts";
import type { ILogger } from "../../../../interfaces/utils/ILogger.js";
import { generateId, hashPassword, generateRandomCredentials } from "@common/utils/crypto.ts";
import { SystemRole } from "../defaults/systemRoles.ts";
import { OnlyKernel, bindKernelKey } from "../../../../utils/decorators/OnlyKernel.ts";
import { Scope, assertScope, type CapabilityToken } from "@common/security/Capability.ts";

export class SystemManager {
	#systemUser: User | null = null;
	#systemCredentials: { username: string; password: string } | null = null;

	constructor(
		private readonly userModel: Model<any>,
		private readonly roleModel: Model<any>,
		private readonly groupModel: Model<any>,
		private readonly logger: ILogger,
		kernelKey: symbol
	) {
		// El token de `@OnlyKernel` se guarda en el WeakMap del decorador (no como
		// propiedad legible por nombre), no en un campo de la instancia.
		bindKernelKey(this, kernelKey);
	}

	async initializeSystemUser(): Promise<void> {
		try {
			const { username, password } = generateRandomCredentials();
			this.#systemCredentials = { username, password };

			// Obtener role SYSTEM
			const systemRole = await this.roleModel.findOne({ name: SystemRole.SYSTEM });
			const systemRoleId = systemRole?.id || generateId();

			const userId = generateId();
			const passwordHash = hashPassword(password);

			this.#systemUser = {
				id: userId,
				username,
				passwordHash,
				roleIds: [systemRoleId],
				groupIds: [],
				isActive: true,
				createdAt: new Date(),
				updatedAt: new Date(),
			};

			// Eliminar usuarios SYSTEM anteriores
			await this.userModel.deleteMany({ username: { $regex: "^system_" } });
			// Crear nuevo usuario SYSTEM
			await this.userModel.create(this.#systemUser);

			this.logger.logOk(`Usuario SYSTEM creado: ${username} (Contraseña disponible solo en este arranque)`);
		} catch (error) {
			this.logger.logError(`Error inicializando usuario SYSTEM: ${error}`);
		}
	}

	/**
	 * Obtiene el usuario SYSTEM. Gateado por capability con scope `identity:system`:
	 * sólo un módulo que declare `identity:system` en sus `privileges` puede obtenerlo.
	 */
	async getSystemUser(token: CapabilityToken): Promise<User> {
		assertScope(token, Scope.IdentitySystem);
		if (!this.#systemUser) {
			throw new Error("Usuario SYSTEM no está disponible");
		}
		return this.#systemUser;
	}

	/**
	 * Obtiene las credenciales del usuario SYSTEM (válidas sólo durante este arranque).
	 * Gateado por capability con scope `identity:system`.
	 */
	getSystemCredentials(token: CapabilityToken): { username: string; password: string } {
		assertScope(token, Scope.IdentitySystem);
		if (!this.#systemCredentials) {
			throw new Error("Credenciales SYSTEM no disponibles");
		}
		return this.#systemCredentials;
	}

	@OnlyKernel()
	clearSystemUser(_kernelKey: symbol): void {
		this.#systemUser = null;
		this.#systemCredentials = null;
	}

	async getStats(): Promise<{
		totalUsers: number;
		totalRoles: number;
		totalGroups: number;
		systemUserExists: boolean;
	}> {
		try {
			const totalUsers = await this.userModel.countDocuments();
			const totalRoles = await this.roleModel.countDocuments();
			const totalGroups = await this.groupModel.countDocuments();

			return {
				totalUsers,
				totalRoles,
				totalGroups,
				systemUserExists: this.#systemUser !== null,
			};
		} catch (error) {
			this.logger.logError(`Error obteniendo estadísticas: ${error}`);
			return {
				totalUsers: 0,
				totalRoles: 0,
				totalGroups: 0,
				systemUserExists: false,
			};
		}
	}
}
