import { Logger } from "../../utils/logger/Logger.js";

/**
 * Hallazgo de una pasada de autolimpieza: un tipo de huérfano y qué se hizo con él.
 * Un módulo devuelve uno por cada colección/recurso que revisa.
 */
export interface OrphanScan {
	/** Qué se revisó, tal cual sale en el log: `"mail_accounts"`, `"objetos S3 sin adjunto"`, … */
	scope: string;
	/** Huérfanos detectados. */
	found: number;
	/** Cuántos se eliminaron. Ausente o 0 en modo reporte. */
	removed?: number;
	/** Detalle corto para el log: una muestra de ids/direcciones, el motivo, … */
	detail?: string;
}

export interface DevCleanupOptions {
	/**
	 * `true` fuera de desarrollo: el módulo debe **detectar y reportar** los huérfanos,
	 * nunca borrarlos. Borrar datos de producción no es trabajo de un hook de arranque.
	 */
	dryRun: boolean;
}

/** Módulo que sabe limpiar sus propios huérfanos (ver `IModule.devCleanup`). */
interface DevCleanupCapable {
	devCleanup?(opts: DevCleanupOptions): Promise<OrphanScan[] | OrphanScan | void>;
}

const logger = Logger.getLogger("devCleanup");

const toScans = (result: OrphanScan[] | OrphanScan | void): OrphanScan[] => {
	if (!result) return [];
	return Array.isArray(result) ? result : [result];
};

function report(label: string, dryRun: boolean, scans: OrphanScan[]): void {
	for (const scan of scans) {
		if (!scan?.found) continue; // Nada que decir: el arranque no se ensucia con "0 huérfanos".
		const detail = scan.detail ? ` — ${scan.detail}` : "";
		if (dryRun) {
			// En producción el hook sólo mira: el aviso es para que alguien decida qué hacer.
			logger.logWarn(`${label}: ${scan.found} huérfano(s) en ${scan.scope}${detail}`);
		} else {
			logger.logOk(`${label}: ${scan.removed ?? 0}/${scan.found} huérfano(s) eliminados en ${scan.scope}${detail}`);
		}
	}
}

/**
 * Dispara la autolimpieza de huérfanos de un módulo recién arrancado.
 *
 * **Fire‑and‑forget a propósito**: barrer huérfanos puede recorrer colecciones enteras y
 * nunca debe demorar el arranque ni tumbar el módulo si falla. Por eso no se espera el
 * resultado y cualquier error se degrada a un warning.
 *
 * En desarrollo (`NODE_ENV=development`) el módulo limpia; en cualquier otro entorno corre
 * en modo reporte (`dryRun`) y lo encontrado sale por log. Los módulos sin `devCleanup`
 * (la mayoría) no pagan nada: se sale en el `typeof`.
 */
export function runDevCleanup(module: unknown, label: string): void {
	const candidate = module as DevCleanupCapable | null | undefined;
	if (typeof candidate?.devCleanup !== "function") return;

	const dryRun = process.env.NODE_ENV !== "development";
	void Promise.resolve()
		.then(() => candidate.devCleanup!({ dryRun }))
		.then((result) => report(label, dryRun, toScans(result)))
		.catch((e: unknown) => logger.logWarn(`${label}: autolimpieza fallida (ignorada): ${(e as Error)?.message ?? e}`));
}
