/**
 * Contrato público del **ModerationService** (clase principal).
 *
 * Vive en `@common` para que otros servicios consuman moderación por **interfaz**
 * sin importar la clase concreta del preset `IAM`. La clase concreta hace
 * `implements IModerationService`. Toda la superficie operativa se expone tras el
 * gate `_internal` (scope `moderation:internal`).
 */

import type { BanInput, BanLookupResult, BanRecord } from "./Moderation.js";
import type { User } from "./User.ts";
import type { CapabilityToken } from "../../security/Capability.ts";

/** Superficie operativa completa de moderación (gate `moderation:internal`). */
export interface ModerationInternalApi {
	// Hot-path lookups (login flow, sin auth)
	isEmailBanned(rawEmail: string): Promise<BanLookupResult>;
	isIpBanned(rawIp: string): Promise<BanLookupResult>;
	recordLoginAttemptIp(userId: string, rawIp: string): Promise<void>;
	// Mutaciones internas sin auth (retention purge, sync runner)
	banPlatformUser(
		user: Pick<User, "id" | "email" | "linkedAccounts" | "lastLogin">,
		args: { reason: string; expiresAt?: Date | null; source?: BanInput["source"]; externalId?: string }
	): Promise<BanRecord>;
	unbanByUserIdInternal(userId: string, reason?: string): Promise<number>;
	// Mutaciones admin (auth via token + PermissionChecker en repo)
	addRawBan(input: BanInput, token: string): Promise<BanRecord>;
	banUserById(userId: string, args: { reason: string; expiresAt?: Date | null }, token: string): Promise<BanRecord>;
	unbanUserById(userId: string, reason: string | undefined, token: string): Promise<number>;
	unbanByExternalId(source: string, externalId: string, reason: string | undefined, token: string): Promise<number>;
	listBans(opts: { activeOnly?: boolean; limit?: number; offset?: number; q?: string }, token: string): Promise<{ items: BanRecord[]; total: number }>;
	/** Guard de jerarquía: el actor no puede moderarse a sí mismo ni a usuarios de jerarquía ≥. */
	assertCanModerate(actorId: string | undefined, targetUserId: string): Promise<void>;
}

export interface IModerationService {
	_internal(token: CapabilityToken): ModerationInternalApi;
}
