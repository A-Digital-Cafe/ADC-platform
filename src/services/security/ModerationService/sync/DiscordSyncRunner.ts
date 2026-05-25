import type MongoProvider from "../../../../providers/object/mongo/index.js";
import type IdentityManagerService from "../../../core/IdentityManagerService/index.js";
import type { ILogger } from "../../../../interfaces/utils/ILogger.js";
import type { BanRepository } from "../dao/BanRepository.js";
import type { User, LinkedAccount } from "@common/types/identity/User.js";
import type { BanRecord, BanInput } from "@common/types/identity/Moderation.js";
import { PengubotModlogsAdapter } from "../adapters/PengubotModlogsAdapter.js";

export interface DiscordSyncOptions {
	enabled?: boolean | string;
	intervalMs?: number;
}

/**
 * Encapsula el sync periódico con la colección `modlogs` de pengubot.
 * Responsabilidad única: leer modlogs y emitir bans/unbans contra el `BanRepository`.
 */
export class DiscordSyncRunner {
	#adapter: PengubotModlogsAdapter | null = null;
	#timer: ReturnType<typeof setInterval> | null = null;

	constructor(
		private readonly repo: BanRepository,
		private readonly banPlatformUser: (user: User, args: Omit<BanInput, "emails" | "extraIpHashes" | "lastLoginAt">) => Promise<BanRecord>,
		private readonly identity: IdentityManagerService,
		private readonly kernelKey: symbol,
		private readonly logger: ILogger
	) {}

	async start(pengubot: MongoProvider, opts: DiscordSyncOptions): Promise<void> {
		const enabled = String(opts.enabled ?? "true").toLowerCase() === "true";
		if (!enabled) {
			this.logger.logInfo("[ModerationService] Discord modlog sync deshabilitado");
			return;
		}

		const t0 = Date.now();
		while (!pengubot.isConnected() && Date.now() - t0 < 10000) {
			await new Promise((r) => setTimeout(r, 250));
		}
		if (!pengubot.isConnected()) {
			this.logger.logWarn("[ModerationService] pengubot Mongo no conectó; sync abortado");
			return;
		}

		this.#adapter = new PengubotModlogsAdapter(pengubot, this.logger);
		this.run().catch((err) => this.logger.logWarn(`[ModerationService] sync inicial falló: ${err?.message || err}`));

		const interval = Math.max(60_000, opts.intervalMs ?? 86_400_000);
		this.#timer = setInterval(() => {
			this.run().catch((err) => this.logger.logWarn(`[ModerationService] sync periódico falló: ${err?.message || err}`));
		}, interval);
		this.logger.logInfo(`[ModerationService] Discord modlog sync habilitado (cada ${interval / 1000}s)`);
	}

	async stop(): Promise<void> {
		if (this.#timer) {
			clearInterval(this.#timer);
			this.#timer = null;
		}
		if (this.#adapter) {
			await this.#adapter.close();
			this.#adapter = null;
		}
	}

	async run(): Promise<void> {
		if (!this.#adapter) return;
		const internal = this.identity._internal(this.kernelKey);

		let added = 0;
		for (const log of await this.#adapter.listActiveBans()) {
			try {
				const externalId = String(log._id);
				const user = await internal.users.findByLinkedExternalAccount("discord", log.id);
				if (!user) {
					await this.repo.addBan({
						emails: [],
						extraIpHashes: [],
						reason: log.reason || "Discord ban",
						lastLoginAt: null,
						expiresAt: null,
						source: "discord-modlogs",
						externalId,
					});
					continue;
				}
				await this.banPlatformUser(user as User & { linkedAccounts?: LinkedAccount[] }, {
					reason: log.reason || "Discord ban",
					expiresAt: null,
					source: "discord-modlogs",
					externalId,
				});
				added++;
			} catch (err: any) {
				this.logger.logWarn(`[ModerationService] sync ban (modlog=${log._id}) falló: ${err.message}`);
			}
		}

		let removed = 0;
		for (const log of await this.#adapter.listRevokedBans()) {
			try {
				const n = await this.repo.deactivateBans(
					{ source: "discord-modlogs", externalId: String(log._id) },
					log.reasonUnpenalized || "Discord unban"
				);
				removed += n;
			} catch (err: any) {
				this.logger.logWarn(`[ModerationService] sync unban (modlog=${log._id}) falló: ${err.message}`);
			}
		}

		this.logger.logInfo(`[ModerationService] Discord sync OK (+${added} bans / -${removed} unbans)`);
	}
}
