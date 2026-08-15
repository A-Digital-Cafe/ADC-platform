import { statfs } from "node:fs/promises";
import type { ILogger } from "@interfaces/utils/ILogger.js";
import { STORAGE_TOTAL_FEATURE } from "@common/types/tiers/storage.ts";
import { isScaledValue, planKey, type PlanDefinition } from "@common/types/plans/index.ts";
import type { PlanCatalog } from "./PlanCatalog.ts";

/**
 * ¿Alcanza el disco para vender un plan más? La plataforma corre sobre **un nodo
 * con un disco finito**: prometer 30 GB a diez cuentas Plus es prometer 300 GB
 * que quizá no existan, y sin este control el aviso llega cuando ya se llenó.
 *
 *  - **capacidad**: tamaño real del filesystem (`statfs`), o el valor declarado
 *    si el almacenamiento está afuera.
 *  - **margen** (`headroomPct`): lo que NO se vende — base, logs, índices, SO.
 *  - **sobreventa** (`oversubscription`): cuántas veces se compromete lo
 *    vendible, apostando a que nadie usa el 100 % de su cuota.
 *
 * Se vende si `comprometido + candidato ≤ vendible × sobreventa` **y** además
 * queda libre de verdad: la sobreventa apuesta al uso futuro, no es una excusa
 * para seguir vendiendo con el disco al borde.
 *
 * Fail-open a propósito: si no se puede medir no se bloquea ninguna venta. Un
 * control de capacidad roto que corta la facturación es peor que uno ausente.
 */

/** Config del bloque `private.capacity` del `config.json`. Llega interpolada: todo string. */
export interface CapacityConfig {
	/** Capacidad total declarada en bytes. `0` ⇒ se mide con `statfs` sobre `path`. */
	totalBytes: number;
	/** Dónde medir cuando no hay capacidad declarada. */
	path: string;
	/** Porcentaje que no se vende (sistema, base, logs). */
	headroomPct: number;
	/** Cuántas veces se puede comprometer lo vendible. `1` = sin sobreventa. */
	oversubscription: number;
	/** Por debajo de este porcentaje de disco libre real no se vende nada más. */
	minFreePct: number;
}

function num(raw: unknown, fallback: number, min: number, max = Number.POSITIVE_INFINITY): number {
	const n = Number(raw);
	return Number.isFinite(n) && n >= min && n <= max ? n : fallback;
}

export function readCapacityConfig(raw: Record<string, unknown> | undefined): CapacityConfig {
	return {
		totalBytes: num(raw?.totalBytes, 0, 0),
		path: String(raw?.path || "").trim() || "/",
		// Un margen menor al 10 % no deja aire para la base ni para los logs.
		headroomPct: num(raw?.headroomPct, 25, 10, 90),
		oversubscription: num(raw?.oversubscription, 3, 1, 100),
		minFreePct: num(raw?.minFreePct, 10, 0, 90),
	};
}

/** Cuántas cuentas hay por tier en cada eje. */
export interface SubjectCounts {
	user: Record<string, number>;
	org: Record<string, number>;
}

export interface CountsSource {
	countUsersByTier(): Promise<Record<string, number>>;
	countOrgsByTier(): Promise<Record<string, number>>;
}

/** Estado de capacidad, tal como lo muestran el catálogo y el panel. */
export interface CapacityReport {
	/** `false` si no se pudo medir: en ese caso no se bloquea nada. */
	measured: boolean;
	totalBytes: number;
	/** Libre de verdad en el disco, ahora. */
	freeBytes: number;
	/** Lo que se puede llegar a comprometer (capacidad − margen, por la sobreventa). */
	sellableBytes: number;
	/** Suma de lo prometido a las cuentas que ya existen. */
	committedBytes: number;
	oversubscription: number;
}

/** Veredicto para un plan concreto. */
export interface CapacityVerdict {
	available: boolean;
	/** Clave i18n del motivo cuando `available` es `false`. */
	reason?: "capacity.committed" | "capacity.disk";
}

const CACHE_TTL_MS = 60_000;

/** Los tres valores de política: lo único editable en caliente desde el panel. */
export type CapacityPolicy = Pick<CapacityConfig, "headroomPct" | "oversubscription" | "minFreePct">;

export class CapacityGuard {
	#config: CapacityConfig;
	readonly #catalog: PlanCatalog;
	readonly #counts: CountsSource;
	readonly #logger: ILogger;
	#cached: { report: CapacityReport; expiresAt: number } | null = null;

	constructor(config: CapacityConfig, catalog: PlanCatalog, counts: CountsSource, logger: ILogger) {
		this.#config = config;
		this.#catalog = catalog;
		this.#counts = counts;
		this.#logger = logger;
	}

	/** Descarta la medición cacheada (tras vender un plan o cambiar el catálogo). */
	invalidate(): void {
		this.#cached = null;
	}

	/** La política vigente, para mostrarla junto a la medición. */
	get policy(): CapacityPolicy {
		const { headroomPct, oversubscription, minFreePct } = this.#config;
		return { headroomPct, oversubscription, minFreePct };
	}

	/**
	 * Cambia la política **en este proceso**; persistirla en `platform_settings` es
	 * del caller. Se re-valida con `readCapacityConfig` en vez de confiar en el
	 * número recibido: un margen de 200 % o una sobreventa de 0 dejarían el nodo
	 * sin vender nada.
	 */
	setPolicy(policy: Partial<CapacityPolicy>): CapacityPolicy {
		const merged = readCapacityConfig({
			...this.#config,
			...policy,
			// Los campos que no son política se pasan tal cual para no perderlos.
			totalBytes: this.#config.totalBytes,
			path: this.#config.path,
		});
		this.#config = merged;
		this.invalidate();
		return this.policy;
	}

	/**
	 * Estado actual, cacheado un minuto: lo consulta el catálogo público, que es
	 * anónimo, y un `statfs` más un `$group` por request serían un regalo.
	 */
	async report(): Promise<CapacityReport> {
		if (this.#cached && this.#cached.expiresAt > Date.now()) return this.#cached.report;
		const report = await this.#measure();
		this.#cached = { report, expiresAt: Date.now() + CACHE_TTL_MS };
		return report;
	}

	/**
	 * ¿Se puede ofrecer este plan? `seats` multiplica el pool en el eje org, donde
	 * lo que se compromete depende de cuántos asientos se contraten.
	 */
	async canOffer(axis: "user" | "org", tier: string, seats = 1): Promise<CapacityVerdict> {
		const report = await this.report();
		// Sin medición no se bloquea: ver la nota de fail-open de arriba.
		if (!report.measured) return { available: true };

		const plan = await this.#catalog.getPlan(axis, tier);
		const candidate = plan ? storageOf(plan, seats) : 0;
		// Un plan que no compromete disco (el gratuito, o uno sin la feature) siempre se ofrece.
		if (candidate <= 0) return { available: true };

		if (report.freeBytes < report.totalBytes * (this.#config.minFreePct / 100)) {
			return { available: false, reason: "capacity.disk" };
		}
		if (report.committedBytes + candidate > report.sellableBytes) {
			return { available: false, reason: "capacity.committed" };
		}
		return { available: true };
	}

	async #measure(): Promise<CapacityReport> {
		const empty: CapacityReport = {
			measured: false,
			totalBytes: 0,
			freeBytes: 0,
			sellableBytes: 0,
			committedBytes: 0,
			oversubscription: this.#config.oversubscription,
		};
		try {
			const disk = await this.#disk();
			if (!disk) return empty;
			const committed = await this.#committed();
			const usable = disk.totalBytes * (1 - this.#config.headroomPct / 100);
			return {
				measured: true,
				totalBytes: disk.totalBytes,
				freeBytes: disk.freeBytes,
				sellableBytes: Math.floor(usable * this.#config.oversubscription),
				committedBytes: committed,
				oversubscription: this.#config.oversubscription,
			};
		} catch (error) {
			this.#logger.logWarn(`PlanService: no se pudo medir la capacidad: ${(error as Error).message}`);
			return empty;
		}
	}

	/**
	 * Tamaño y espacio libre del almacenamiento. Con `totalBytes` declarado se lo
	 * usa como techo (el dato vive afuera, ej. un bucket remoto) pero el libre sigue
	 * saliendo del disco local, que es lo que se puede llenar.
	 */
	async #disk(): Promise<{ totalBytes: number; freeBytes: number } | null> {
		let fsTotal = 0;
		let fsFree = 0;
		try {
			const fs = await statfs(this.#config.path);
			fsTotal = Number(fs.blocks) * Number(fs.bsize);
			// `bavail` y no `bfree`: los bloques reservados para root no son nuestros.
			fsFree = Number(fs.bavail) * Number(fs.bsize);
		} catch {
			// Sin `statfs` (path inexistente, plataforma sin soporte) sólo sirve lo declarado.
			if (this.#config.totalBytes <= 0) return null;
		}
		const totalBytes = this.#config.totalBytes > 0 ? this.#config.totalBytes : fsTotal;
		if (totalBytes <= 0) return null;
		// Sin lectura del disco se asume libre todo, con lo que el corte por `minFreePct` no aplica.
		return { totalBytes, freeBytes: fsTotal > 0 ? fsFree : totalBytes };
	}

	/** Bytes prometidos a las cuentas que ya existen, sumando ambos ejes. */
	async #committed(): Promise<number> {
		const [user, org] = await Promise.all([this.#counts.countUsersByTier(), this.#counts.countOrgsByTier()]);
		const plans = await this.#catalog.listPlans();
		const byKey = new Map(plans.map((p) => [planKey(p.axis, p.tier), p]));

		let total = 0;
		for (const [axis, counts] of [
			["user", user],
			["org", org],
		] as const) {
			for (const [tier, count] of Object.entries(counts)) {
				const plan = byKey.get(planKey(axis, tier));
				if (!plan || count <= 0) continue;
				// Los asientos reales de cada org no se consultan una por una: se usa el piso
				// incluido en el plan, que es lo que compromete el alta.
				total += storageOf(plan, plan.includedSeats ?? 1) * count;
			}
		}
		return total;
	}
}

/** Almacenamiento que compromete un plan, ya resuelto el escalado por asiento. */
function storageOf(plan: PlanDefinition, seats: number): number {
	const raw = plan.features[STORAGE_TOTAL_FEATURE];
	if (raw === undefined) return 0;
	if (isScaledValue(raw)) {
		if (raw.base < 0) return 0; // ilimitado: no se puede acotar, no se cuenta
		return raw.base + (raw.perSeat ?? 0) * Math.max(0, seats - 1);
	}
	return typeof raw === "number" && raw > 0 ? raw : 0;
}
