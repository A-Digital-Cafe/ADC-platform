/**
 * Tipos compartidos para el sistema de baneo / anti-evasión.
 * Los hashes son HMAC-SHA256 hex (64 chars).
 */

export type BanSource = "manual" | "discord-modlogs" | "api" | "system";

export interface BanRecord {
	/** UUID del registro */
	id: string;
	/** Hashes de los emails baneados (web + linkedAccounts en el momento del ban) */
	emailHashes: string[];
	/** Hashes de IPs usadas en las últimas 3h al momento del ban */
	ipHashes: string[];
	/** Razón legible (NO PII; texto del moderador o reason del modlog) */
	reason: string;
	/** Fecha del último login conocido (para auditoría) */
	lastLoginAt: Date | null;
	bannedAt: Date;
	/** null = permanente */
	expiresAt: Date | null;
	source: BanSource;
	/**
	 * Referencia externa para idempotencia (e.g. modlog _id, discord userId).
	 * Junto con `source` permite encontrar el ban para revertirlo.
	 */
	externalId?: string;
	/** Si conocemos el userId de la plataforma, lo guardamos */
	userId?: string;
	active: boolean;
	unbannedAt?: Date;
	unbanReason?: string;
}

export interface BanInput {
	emails: ReadonlyArray<string | undefined | null>;
	ips?: ReadonlyArray<string | undefined | null>;
	/** Hashes ya calculados (e.g. desde Redis loginips buffer) */
	extraIpHashes?: ReadonlyArray<string>;
	reason: string;
	lastLoginAt?: Date | null;
	expiresAt?: Date | null;
	source: BanSource;
	externalId?: string;
	userId?: string;
}

export interface BanLookupResult {
	banned: boolean;
	expiresAt?: Date | null;
	reason?: string;
}
