import type { ModuleKind } from "./capabilityPolicy.js";

/** Privilegios efectivamente concedidos a un módulo en su última provisión. */
export interface PrivilegeGrant {
	kind: ModuleKind;
	name: string;
	/** Ruta de origen del módulo (de dónde se leyó el `config.json`). */
	path: string;
	/** Scopes de la businessCap, ordenados (comparación estable). */
	scopes: string[];
	at: number;
}

/** Delta entre la provisión anterior de un módulo y la actual. */
export interface PrivilegeChange {
	grant: PrivilegeGrant;
	/** Scopes que este módulo no tenía la vez anterior. Es lo que hay que mirar. */
	added: string[];
	removed: string[];
	/** Primera provisión del módulo en este proceso (alta de baseline, no escalada). */
	first: boolean;
	/** Scopes declarados que NO se concedieron por faltarles aprobación. */
	withheld: string[];
}

/** Aprobación vigente de un módulo: los scopes que se le permiten declarar. */
export type PrivilegeApprovals = ReadonlyMap<string, readonly string[]>;

/** Clave estable de un módulo dentro del ledger. */
function privilegeKey(kind: ModuleKind, name: string): string {
	return `${kind}:${name}`;
}

/**
 * Registro de los privilegios concedidos a cada módulo y detector de cambios entre
 * provisiones.
 *
 * Por qué existe: el set de privilegios de un módulo sale de su propio `config.json`, y la
 * recarga desde disco (el `git pull` del gestor de módulos, el watcher de dev, el lanzamiento
 * de un pendiente) vuelve a leerlo y re-provisiona la instancia con lo que diga el archivo
 * nuevo. Sin registro, un commit que agrega `privileges` se aplicaría sin dejar rastro:
 * ni log, ni auditoría, ni aviso.
 *
 * El ledger vive en el kernel porque `provisionModule` es el único punto por el que pasan el
 * arranque, el hot-reload y el deploy. La persistencia y la aprobación son del gestor de
 * módulos, que arranca tarde (necesita Mongo) y se engancha por `onChange`/`setApprovals`.
 */
export class PrivilegeLedger {
	readonly #grants = new Map<string, PrivilegeGrant>();
	readonly #subs: Array<(change: PrivilegeChange) => void> = [];
	#approvals: PrivilegeApprovals | null = null;
	#gateEnabled = false;

	/**
	 * Instala el baseline aprobado. Con el gate activo, un scope declarado que no figure en la
	 * aprobación del módulo **no se concede** (los defaults de su tier nunca se gatean).
	 *
	 * `null` (o gate apagado) deja el comportamiento histórico: se concede todo lo declarado y
	 * el cambio sólo se audita. Es el default a propósito — un gate fail-closed sin quién
	 * apruebe deja módulos legítimos sin arrancar tras un deploy.
	 */
	setApprovals(approvals: PrivilegeApprovals | null, gateEnabled: boolean): void {
		this.#approvals = approvals;
		this.#gateEnabled = gateEnabled;
	}

	/**
	 * Scopes declarados que hoy NO se concederían por falta de aprobación. Vacío si el gate
	 * está apagado o si el módulo no tiene baseline (alta: se aprueba sola la primera vez).
	 */
	withheldFor(kind: ModuleKind, name: string, declared: readonly string[]): string[] {
		if (!this.#gateEnabled || !this.#approvals) return [];
		const approved = this.#approvals.get(privilegeKey(kind, name));
		if (!approved) return [];
		return declared.filter((scope) => !approved.includes(scope));
	}

	/** Registra la concesión y emite el delta contra la provisión anterior (si lo hay). */
	record(grant: Omit<PrivilegeGrant, "scopes"> & { scopes: readonly string[] }, withheld: readonly string[] = []): void {
		const key = privilegeKey(grant.kind, grant.name);
		const previous = this.#grants.get(key);
		const scopes = [...grant.scopes].sort((a, b) => a.localeCompare(b));
		const next: PrivilegeGrant = { ...grant, scopes };
		this.#grants.set(key, next);

		const before = new Set(previous?.scopes ?? []);
		const after = new Set(scopes);
		const added = scopes.filter((scope) => !before.has(scope));
		const removed = (previous?.scopes ?? []).filter((scope) => !after.has(scope));
		const first = !previous;

		// Sin delta y sin retenidos no hay nada que contar: la recarga normal de un módulo que
		// no cambió sus privilegios es el caso masivamente mayoritario.
		if (!first && added.length === 0 && removed.length === 0 && withheld.length === 0) return;

		const change: PrivilegeChange = { grant: next, added, removed, first, withheld: [...withheld] };
		for (const sub of this.#subs) {
			try {
				sub(change);
			} catch {
				/* un observador roto no puede romper la provisión de un módulo */
			}
		}
	}

	/** Suscribe un observador de cambios de privilegios (best-effort, nunca propaga errores). */
	onChange(cb: (change: PrivilegeChange) => void): void {
		this.#subs.push(cb);
	}

	/** Snapshot de lo concedido hasta ahora (para diffear contra el baseline persistido). */
	list(): PrivilegeGrant[] {
		return [...this.#grants.values()];
	}
}
