/**
 * Estado **operativo** de este nodo, decidido desde el panel y persistido en disco.
 *
 * Un archivo y no `ADC_INFRA_COMPOSE`: la decisión de qué motores levanta el nodo tiene que
 * sobrevivir a un reinicio y a que alguien copie el `.env` de otra máquina, o un nodo vuelve de un
 * corte levantando un Mongo que no le corresponde. Y no en Mongo, porque se lee **antes** de que
 * exista: la base que lo guardaría es uno de los contenedores que esta decisión levanta.
 *
 * Excepción de `process.env` por el mismo motivo que `cluster-env.ts`: son banderas del proceso,
 * anteriores a cualquier `config.json` interpolado.
 */

import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { isRealProduction } from "./runtime-env.js";
import { setNodeRoleOverride, type NodeRole } from "./cluster-env.js";

/** Qué hace el nodo al arrancar. */
export type PowerMode = "on" | "standby";

export interface NodeState {
	/**
	 * `standby` = el nodo arranca, levanta sus motores y entra al registro, pero **no carga ninguna
	 * app** y `/healthz` responde 503. Está vivo y comandable; no sirve tráfico.
	 */
	power: PowerMode;
	/**
	 * Qué composes de `src/common/docker/` levanta, con la misma sintaxis de `ADC_INFRA_COMPOSE`.
	 * `null` = nadie lo decidió todavía desde el panel (y entonces manda el entorno).
	 */
	infra: string | null;
	/**
	 * Rol del nodo, o `null` = nadie lo decidió desde el panel (y entonces manda `ADC_NODE_ROLE`).
	 * Está acá para que promover un secundario sea apretar un botón y no entrar por SSH.
	 */
	role: NodeRole | null;
	updatedAt: string;
	updatedBy: string | null;
}

const STATE_DIR = "env";
const STATE_FILE = "node-state.json";
/** Donde se deja el archivo ilegible, para poder mirarlo en vez de perderlo al arreglar el arranque. */
const CORRUPT_FILE = "node-state.corrupt.json";

const DEFAULT_STATE: NodeState = { power: "on", infra: null, role: null, updatedAt: "", updatedBy: null };

function statePath(): string {
	return resolve(process.cwd(), STATE_DIR, STATE_FILE);
}

function corruptCopyPath(): string {
	return resolve(process.cwd(), STATE_DIR, CORRUPT_FILE);
}

/** Cache de proceso: esto se consulta por cada compose y en cada sonda de salud. */
let cached: NodeState | null = null;
let corrupt: string | null = null;

function isPowerMode(value: unknown): value is PowerMode {
	return value === "on" || value === "standby";
}

function isNodeRole(value: unknown): value is NodeRole {
	return value === "primary" || value === "secondary";
}

/**
 * El estado en disco, o el default.
 *
 * «No existe» (primer arranque, el default es legítimo) y «existe pero no parsea» son casos
 * distintos: el default es `power: "on"` e `infra: null`, lo contrario de lo que el archivo
 * custodiaba, así que aplicarlo en silencio devuelve a rotación un nodo puesto en espera. Ante un
 * archivo ilegible lo aparta como `node-state.corrupt.json` y deja que
 * {@link assertNodeStateReadable} corte el arranque en producción.
 */
export function readNodeState(): NodeState {
	if (cached) return cached;
	const file = statePath();
	if (!existsSync(file)) {
		// Que NO exista el estado pero SÍ la copia apartada no es un primer arranque: es el arranque
		// siguiente al que encontró el archivo roto. Sin esta rama el centinela duraba una sola
		// ejecución —`corrupt` es de este proceso—, así que bajo un supervisor el nodo moría una vez,
		// volvía a arrancar limpio y congelaba «levantar la infraestructura entera».
		if (existsSync(corruptCopyPath())) {
			corrupt = `quedó sin resolver el estado ilegible de un arranque anterior (env/${CORRUPT_FILE})`;
			console.error(
				`[node-state] hay un '${CORRUPT_FILE}' sin resolver y no hay '${STATE_FILE}'. ` +
					"Mientras siga así, este nodo no sabe qué le tocaba hacer. Para salir: restaurá la copia como " +
					`'${STATE_FILE}' si se puede reparar, o borrala para aceptar la pérdida y volver a decidir desde el panel.`
			);
		}
		cached = { ...DEFAULT_STATE };
		return cached;
	}
	try {
		const raw = JSON.parse(readFileSync(file, "utf-8")) as Partial<NodeState>;
		cached = {
			power: isPowerMode(raw.power) ? raw.power : "on",
			infra: typeof raw.infra === "string" ? raw.infra : null,
			role: isNodeRole(raw.role) ? raw.role : null,
			updatedAt: typeof raw.updatedAt === "string" ? raw.updatedAt : "",
			updatedBy: typeof raw.updatedBy === "string" ? raw.updatedBy : null,
		};
		corrupt = null;
	} catch (error) {
		corrupt = (error as Error).message;
		preserveCorruptFile(file);
		// `console` y no un logger: esto corre antes de que exista ninguno.
		console.error(
			`[node-state] '${file}' existe pero no se puede leer (${corrupt}). ` +
				`Se guardó una copia como '${CORRUPT_FILE}'. La decisión del panel sobre este nodo (en servicio o en espera, ` +
				`qué motores levanta) se perdió y NO se va a adivinar.`
		);
		cached = { ...DEFAULT_STATE };
	}
	return cached;
}

/** Best-effort: aparta el archivo ilegible en vez de dejar que el próximo write lo pise. */
function preserveCorruptFile(file: string): void {
	try {
		const target = corruptCopyPath();
		if (existsSync(target)) unlinkSync(target);
		renameSync(file, target);
	} catch {
		// Si no se puede ni mover, el aviso de arriba ya alcanza: no vale abortar por esto.
	}
}

/**
 * Corta el arranque en producción si el estado quedó ilegible; en desarrollo no hace nada, porque
 * ahí no hay clúster al que corromperle los datos.
 */
export function assertNodeStateReadable(): void {
	readNodeState();
	if (corrupt && isRealProduction()) {
		throw new Error(
			`El estado operativo de este nodo (env/${STATE_FILE}) no se puede leer: ${corrupt}. ` +
				`Se dejó una copia en env/${CORRUPT_FILE}. Arrancar igual significaría inventar qué motores levanta este nodo, ` +
				"y en un clúster eso es levantar una base de datos en paralelo a la del resto. " +
				`Revisá la copia y, si no se puede reparar, borrá env/${STATE_FILE} y volvé a aplicar el estado desde el panel.`
		);
	}
}

/**
 * Persiste los campos indicados y devuelve el estado resultante.
 *
 * Escribe a un temporal y **renombra**: `rename(2)` en el mismo filesystem es atómico, así que un
 * corte a mitad deja el archivo viejo entero en vez de uno truncado. El `fsync` previo evita que el
 * rename llegue al disco antes que el contenido.
 */
export function writeNodeState(patch: Partial<Pick<NodeState, "power" | "infra" | "role">>, actor?: string | null): NodeState {
	const current = readNodeState();
	const next: NodeState = {
		power: patch.power ?? current.power,
		infra: patch.infra === undefined ? current.infra : patch.infra,
		role: patch.role === undefined ? current.role : patch.role,
		updatedAt: new Date().toISOString(),
		updatedBy: actor ?? null,
	};
	const dir = resolve(process.cwd(), STATE_DIR);
	if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o755 });

	const target = statePath();
	const tmp = `${target}.${process.pid}.tmp`;
	writeFileSync(tmp, `${JSON.stringify(next, null, "\t")}\n`, { mode: 0o600 });
	const fd = openSync(tmp, "r");
	try {
		fsyncSync(fd);
	} finally {
		closeSync(fd);
	}
	renameSync(tmp, target);

	// Escribir un estado nuevo ES la resolución del caso corrupto: ya hay una decisión explícita, así
	// que la copia apartada deja de ser un pendiente y no tiene que bloquear un arranque futuro.
	try {
		if (existsSync(corruptCopyPath())) unlinkSync(corruptCopyPath());
	} catch {
		// El estado nuevo ya está en su lugar; no poder borrar la copia no invalida la escritura.
	}

	cached = next;
	corrupt = null;
	return next;
}

/** Sólo para pruebas y para releer tras escribir desde otro proceso. */
export function invalidateNodeStateCache(): void {
	cached = null;
	corrupt = null;
}

/** `standby` = arranca sin apps y drenado. */
export function powerMode(): PowerMode {
	return readNodeState().power;
}

/**
 * Qué composes levanta este nodo, ya resuelto entre el archivo y el entorno.
 *
 * **En producción manda el archivo y `ADC_INFRA_COMPOSE` se ignora**: la topología de un nodo la
 * decide el panel, no la variable que quedó en el `.env` de la máquina. En desarrollo manda el
 * entorno, donde la variable es una herramienta de iteración (`ADC_INFRA_COMPOSE=mongo bun run dev`).
 *
 * La primera vez que producción arranca sin archivo se congela lo que dice el entorno, para que la
 * migración no cambie el comportamiento de nadie.
 */
export function effectiveInfraSelection(): string | undefined {
	const raw = process.env.ADC_INFRA_COMPOSE;
	if (!isRealProduction()) return raw;

	// Se comprueba acá y no sólo en el arranque del kernel: con el archivo ilegible, la rama de abajo
	// congelaría `raw ?? "*"` —levantar la infraestructura entera— pisando la decisión recién perdida.
	assertNodeStateReadable();
	const state = readNodeState();
	if (state.infra !== null) return state.infra;
	// `raw === undefined` (todos) también se persiste, como `*`: si no, el próximo arranque volvería
	// a depender del entorno.
	const captured = raw ?? "*";
	writeNodeState({ infra: captured }, "migración automática");
	return captured;
}

/**
 * Instala en `cluster-env` el rol que decidió el panel, si lo hay.
 *
 * Tiene que correr **antes que nada**: `shouldRunInfraCompose` consulta el rol para decidir qué
 * motores levanta la máquina (el plano de control de la red privada sólo corre en el primario), así
 * que llamarla tarde es levantar los composes con el rol viejo.
 *
 * En desarrollo no hace nada, por el mismo motivo que `effectiveInfraSelection`.
 */
export function applyNodeRoleFromState(): void {
	if (!isRealProduction()) return;
	assertNodeStateReadable();
	setNodeRoleOverride(readNodeState().role);
}

/**
 * Supervisor que va a volver a levantar el proceso si sale, o `null` si no hay ninguno.
 *
 * **Bajo un supervisor, «apagar» es «reiniciar»**: para sacar un nodo de servicio y dejarlo así hay
 * que usar `standby`. El panel necesita distinguirlos o «Apagar» parece roto.
 */
export function supervisor(): "pm2" | "systemd" | null {
	if (process.env.pm_id !== undefined || process.env.PM2_HOME !== undefined) return "pm2";
	if (process.env.INVOCATION_ID !== undefined) return "systemd";
	return null;
}
