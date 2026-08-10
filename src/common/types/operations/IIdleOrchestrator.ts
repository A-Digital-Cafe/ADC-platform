import type { CapabilityToken } from "../../security/Capability.ts";

/**
 * Contrato del orquestador de **trabajos de momentos ociosos**. Vive en `@common` porque lo
 * implementa `OperationsService` y lo consumen módulos que no pueden importar su clase (presets):
 * se resuelve por nombre y, si no está cargado, el productor simplemente se queda sin trabajo de
 * fondo — nunca es motivo para que falle su arranque.
 */

/** @public Lo que recibe un lote para saber cuándo cortar. */
export interface IdleRunContext {
	/**
	 * Se aborta al agotarse el presupuesto del lote o al descargarse el módulo dueño. **Hay que
	 * mirarlo entre unidad y unidad**: es lo único que evita bloquear el event loop.
	 */
	signal: AbortSignal;
	/** `Date.now()` límite del lote. Equivalente a `signal`, cómodo para comparar en el loop. */
	deadline: number;
}

export interface IdleJobDefinition {
	/** Estable dentro de su módulo. Re-registrar el mismo id **reemplaza** en vez de duplicar. */
	id: string;
	/** Qué hace, para el diagnóstico. */
	description?: string;
	/** Espera mínima entre lotes. Es un piso: bajo carga los lotes se espacian solos. */
	intervalMs?: number;
	/** Techo de duración de un lote. Pasado eso se aborta la señal y se retoma en el próximo turno. */
	batchBudgetMs?: number;
	/**
	 * Procesa **un lote** y devuelve cuántas unidades tocó. Devolver `0` ("nada pendiente") espacia
	 * el trabajo progresivamente. Nunca lanzar por una unidad suelta: acumular y seguir, como en
	 * `devCleanup`.
	 */
	run(ctx: IdleRunContext): Promise<number>;
}

/** Foto de un trabajo registrado, para diagnóstico y para el panel de módulos. */
export interface IdleJobStatus {
	/** `<owner>:<id>`. */
	key: string;
	owner: string;
	id: string;
	description: string | null;
	intervalMs: number;
	lastRunAt: string | null;
	lastDurationMs: number | null;
	lastProcessed: number | null;
	/** Lotes consecutivos que no encontraron trabajo. Alimenta el espaciado progresivo. */
	idleRounds: number;
	totalProcessed: number;
	lastError: string | null;
	running: boolean;
}

export interface IIdleOrchestrator {
	/**
	 * Registra (o reemplaza) un trabajo de fondo. El dueño sale de `cap.owner`, infalsificable:
	 * nadie registra ni da de baja trabajos ajenos.
	 */
	registerIdleJob(cap: CapabilityToken, job: IdleJobDefinition): void;
	/** Da de baja un trabajo propio. Devuelve `false` si no existía. */
	unregisterIdleJob(cap: CapabilityToken, id: string): boolean;
	/** Da de baja **todos** los trabajos del módulo. Se llama desde su `stop()`. */
	unregisterIdleJobs(cap: CapabilityToken): number;
	/** Estado de todos los trabajos registrados. */
	idleJobs(): IdleJobStatus[];
}
