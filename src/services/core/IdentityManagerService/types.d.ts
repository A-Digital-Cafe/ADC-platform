/**
 * Estadísticas del sistema de identidad
 */
export interface IdentityStats {
	totalUsers: number;
	totalRoles: number;
	totalGroups: number;
	systemUserExists: boolean;
	totalOrganizations: number;
	totalRegions: number;
}

/** Nota bilingüe legible por la persona dentro del export de datos. */
export interface BilingualNote {
	es: string;
	en: string;
}

/** Sección del export de datos aportada por un servicio (o su ausencia declarada). */
export interface UserDataExportSection {
	available: boolean;
	data?: unknown;
	note?: BilingualNote;
}

/**
 * Documento completo del export de datos personales (portabilidad, art. 14
 * Ley 25.326 / arts. 15 y 20 RGPD): una sección por servicio + metadatos.
 */
export interface UserDataExportDocument {
	format: "adc-user-data-export";
	formatVersion: number;
	generatedAt: string;
	userId: string;
	username: string;
	notes: BilingualNote;
	sections: Record<string, UserDataExportSection>;
}

/**
 * Managers con scope de organización
 */
export interface OrgScopedManagers {
	org: Organization;
	users: UserManager;
	roles: RoleManager;
	groups: GroupManager;
	initialize(): Promise<void>;
}
