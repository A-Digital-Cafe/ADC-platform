import * as fs from "node:fs/promises";
import { existsSync } from "node:fs";
import * as path from "node:path";
import { execFileSync } from "node:child_process";
import net from "node:net";
import { Logger } from "../logger/Logger.ts";
import { ILogger } from "../../interfaces/utils/ILogger.js";
import os from "node:os";
import { shouldRunInfraCompose } from "../../common/utils/cluster-env.js";
import { effectiveInfraSelection } from "../../common/utils/node-state.js";
import { isRealProduction } from "../../common/utils/runtime-env.js";

/** Puerto publicado por un compose: dirección de host y puerto. */
interface PublishedPort {
	host: string;
	port: number;
}

/** Techo del probe de readiness: pasado esto se sigue con el boot avisando, nunca se cuelga. */
const READY_TIMEOUT_MS = 20_000;
/** Cadencia del poll de `docker compose ps`. */
const READY_POLL_MS = 250;

/** Fila de `docker compose ps --format json` (sólo los campos que interesan). */
interface ComposePsRow {
	Service?: string;
	State?: string;
	Health?: string;
}

/** Compose levantado por el kernel en esta corrida, con la capa a la que pertenece. */
export interface ComposeTarget {
	type: "app" | "service" | "common";
	name: string;
	dir: string;
}

/** Vista sólo‑lectura de la infra Docker: enumera y reporta, nunca levanta ni baja nada. */
export interface DockerInspector {
	listComposeTargets(): ComposeTarget[];
	dockerAvailable(): boolean;
	dockerPath(): string | null;
}

/**
 * Gestiona las operaciones de Docker Compose para apps, servicios y contenedores comunes del Kernel.
 */
export class DockerManager {
	readonly #logger: ILogger = Logger.getLogger("DockerManager");
	readonly #dockerPath: string | null;
	readonly #appDockerComposeMap = new Map<string, string>();
	readonly #serviceDockerComposeMap = new Map<string, string>();
	readonly #commonDockerComposeMap = new Map<string, string>();

	constructor() {
		this.#dockerPath = this.#locateDocker();
	}

	/**
	 * Ubica el binario de docker. Devuelve `null` en vez de lanzar: los módulos corren in‑process
	 * (docker sólo levanta infra externa opcional), y lanzar acá impediría construir el Kernel.
	 */
	#locateDocker(): string | null {
		try {
			const found =
				os.platform() === "win32"
					? String.raw`C:\Program Files\Docker\Docker\resources\bin\docker.exe`
					: execFileSync("/usr/bin/which", ["docker"]).toString().trim();
			// En win32 la ruta es fija (no hay `which`): hay que confirmarla o `dockerAvailable()` mentiría.
			if (found && existsSync(found)) return found;
			throw new Error(`Ruta de docker inexistente: ${found}`);
		} catch (error) {
			this.#logger.logWarn(`Docker no disponible en este host (${error}). La infraestructura en contenedores queda deshabilitada.`);
			return null;
		}
	}

	/**
	 * Ejecuta docker-compose up -d en el directorio especificado.
	 */
	async runDockerCompose(dir: string, name: string, type: "app" | "service" | "common"): Promise<void> {
		const dockerPath = this.#requireDocker();
		const dockerComposeFile = path.join(dir, "docker-compose.yml");
		await fs.stat(dockerComposeFile);

		// Antes de levantar: docker falla en silencio si el puerto está tomado (ver #warnOnBusyPorts).
		await this.#warnOnBusyPorts(dockerComposeFile, name);

		this.#logger.logInfo(`Iniciando servicios Docker para ${name}...`);

		const { spawn } = await import("node:child_process");
		const docker = spawn(dockerPath, ["compose", "-f", dockerComposeFile, "up", "-d"], {
			cwd: dir,
			stdio: "pipe",
		});

		return new Promise((resolve, reject) => {
			let output = "";
			docker.stdout?.on("data", (data) => {
				output += data.toString();
			});
			docker.stderr?.on("data", (data) => {
				output += data.toString();
			});
			docker.on("close", (code) => {
				if (code === 0) {
					this.#logger.logOk(`Servicios Docker iniciados para ${name}`);

					let map;
					if (type === "app") map = this.#appDockerComposeMap;
					else if (type === "service") map = this.#serviceDockerComposeMap;
					else map = this.#commonDockerComposeMap;
					map.set(name, dir);
					this.#waitUntilReady(dockerComposeFile, name).then(resolve, resolve);
				} else {
					this.#logger.logWarn(`docker-compose falló con código ${code}`);
					if (output.trim()) {
						this.#logger.logWarn(`Output: ${output.trim()}`);
					}
					reject(new Error(`docker-compose exit code: ${code}`));
				}
			});
		});
	}

	/**
	 * Espera a que el stack esté **realmente** listo: un delay fijo es a la vez de más
	 * (redis responde en ~200 ms) y de menos (mongo en frío tarda más), y su fallo es
	 * silencioso — el kernel sigue y los providers se comen el error de conexión.
	 *
	 * Poll de `docker compose ps --format json`, que lista **sólo los contenedores corriendo**:
	 *  - servicio con healthcheck → se espera a `healthy`;
	 *  - servicio sin healthcheck → alcanza con `running`;
	 *  - one-shots que ya terminaron (`minio-init`) no aparecen, así que no se los espera.
	 *
	 * Por eso no se usa `docker compose up --wait`: ese falla cuando un servicio del compose sale
	 * antes de ponerse healthy, que es exactamente lo que hace `minio-init`.
	 *
	 * Nunca lanza ni cuelga el boot: al vencer el techo avisa y sigue.
	 */
	async #waitUntilReady(dockerComposeFile: string, name: string): Promise<void> {
		if (!this.#dockerPath) return;
		const dockerPath = this.#dockerPath;
		const deadline = Date.now() + READY_TIMEOUT_MS;
		let lastPending = "";

		while (Date.now() < deadline) {
			const rows = DockerManager.#composePs(dockerPath, dockerComposeFile);
			if (rows === null) return; // `ps` no responde: no bloquear el boot por el probe
			const pending = rows.filter((r) => r.State !== "running" || r.Health === "starting" || r.Health === "unhealthy");
			if (pending.length === 0) return;
			lastPending = pending.map((r) => `${r.Service ?? "?"}=${r.Health || r.State}`).join(", ");
			await new Promise((r) => setTimeout(r, READY_POLL_MS));
		}

		this.#logger.logWarn(
			`[${name}] no quedó listo en ${READY_TIMEOUT_MS / 1000}s (${lastPending || "sin detalle"}); se sigue con el arranque. ` +
				`Los providers que dependan de él van a reintentar la conexión.`
		);
	}

	/** Filas de `docker compose ps` (JSON por línea), o `null` si el comando falla. */
	static #composePs(dockerPath: string, dockerComposeFile: string): ComposePsRow[] | null {
		try {
			const raw = execFileSync(dockerPath, ["compose", "-f", dockerComposeFile, "ps", "--format", "json"], {
				encoding: "utf8",
				timeout: 5000,
			}).trim();
			if (!raw) return [];
			// v2 emite un objeto por línea; algunas versiones emiten un array.
			if (raw.startsWith("[")) return JSON.parse(raw) as ComposePsRow[];
			return raw
				.split("\n")
				.filter((l) => l.trim())
				.map((l) => JSON.parse(l) as ComposePsRow);
		} catch {
			return null;
		}
	}

	/**
	 * Interpola `${VAR}` y `${VAR:-default}` con el entorno que va a heredar `docker compose`.
	 * Sin esto, una IP de publicación parametrizada (`${MINIO_BIND_HOST:-127.0.0.1}:9000:9000`)
	 * se descartaría como si fuera un rango de puertos y el aviso de puerto ocupado se perdería.
	 */
	static #expandEnv(spec: string): string {
		return spec.replaceAll(/\$\{(\w+)(?::?-([^}]*))?\}/g, (_match, name: string, fallback?: string) => process.env[name] || fallback || "");
	}

	/**
	 * Puertos de host publicados por un `docker-compose.yml`. Parseo acotado a la lista `ports:`
	 * (no se justifica una dependencia de YAML para leer una lista de strings). Soporta las formas
	 * `"IP:host:contenedor"` y `"host:contenedor"`; se ignoran los rangos y los puertos sueltos
	 * (`"80"`), que docker asigna al azar en el host y por lo tanto no pueden chocar.
	 */
	static #parsePublishedPorts(content: string): PublishedPort[] {
		const out: PublishedPort[] = [];
		let inPorts = false;
		let portsIndent = 0;
		for (const rawLine of content.split(/\r?\n/)) {
			const line = rawLine.replace(/#.*$/, "").trimEnd();
			if (!line.trim()) continue;
			const indent = line.length - line.trimStart().length;
			if (/^ports:\s*$/.test(line.trim())) {
				inPorts = true;
				portsIndent = indent;
				continue;
			}
			if (!inPorts) continue;
			// La lista termina en cuanto aparece algo que no es un ítem más indentado que `ports:`.
			const item = /^-\s*(.+)$/.exec(line.trim());
			if (indent <= portsIndent || !item) {
				inPorts = false;
				continue;
			}
			const spec = DockerManager.#expandEnv(item[1].trim().replace(/^["']|["']$/g, "").replace(/\/(tcp|udp)$/i, ""));
			if (spec.includes("-") || !spec.includes(":")) continue; // rangos y puertos sueltos
			const parts = spec.split(":");
			// [ip, host, contenedor] | [host, contenedor]. El puerto de host es el ANTEÚLTIMO.
			const host = parts.length >= 3 ? parts.slice(0, -2).join(":") : "0.0.0.0";
			const port = Number(parts.at(-2));
			if (Number.isInteger(port) && port > 0) out.push({ host, port });
		}
		return out;
	}

	/**
	 * Puertos de host que YA publica algún contenedor. Sin esto el chequeo avisaría en cada arranque
	 * por los contenedores que el propio kernel dejó levantados en la corrida anterior.
	 */
	#dockerPublishedPorts(): Set<number> {
		const ports = new Set<number>();
		if (!this.#dockerPath) return ports;
		try {
			const out = execFileSync(this.#dockerPath, ["ps", "--format", "{{.Ports}}"], { encoding: "utf8", timeout: 5000 });
			// docker colapsa los consecutivos en rangos (`127.0.0.1:9000-9001->9000-9001/tcp`),
			// así que hay que expandirlos o se cuelan como ocupados los que publica el propio kernel.
			for (const [, from, to] of out.matchAll(/:(\d+)(?:-(\d+))?->/g)) {
				const start = Number(from);
				const end = to ? Number(to) : start;
				for (let p = start; p <= end; p++) ports.add(p);
			}
		} catch {
			// Best-effort: si `docker ps` falla, se avisa de más antes que de menos.
		}
		return ports;
	}

	/**
	 * `true` si algo ya escucha en esa dirección.
	 *
	 * Se prueba CONECTANDO, no abriendo: un bind sobre un puerto privilegiado (<1024) sin root falla
	 * con `EACCES` en vez de `EADDRINUSE` y daría siempre "libre" (caso del 25). La conexión se
	 * cierra en el acto, sin enviar nada.
	 */
	static #portInUse({ host, port }: PublishedPort): Promise<boolean> {
		return new Promise((resolve) => {
			const target = host === "0.0.0.0" || host === "::" ? "127.0.0.1" : host;
			const probe = net.connect({ host: target, port });
			const done = (inUse: boolean): void => {
				probe.destroy();
				resolve(inUse);
			};
			probe.setTimeout(700);
			probe.once("connect", () => done(true));
			// Rechazo (nadie escucha) o puerto filtrado: en ambos casos conviene NO avisar,
			// para que un falso positivo no entrene al operador a ignorar el aviso.
			probe.once("error", () => done(false));
			probe.once("timeout", () => done(false));
		});
	}

	/**
	 * Avisa de los puertos que otro proceso del host ya tiene tomados.
	 *
	 * Importa porque el fallo es SILENCIOSO: docker aborta el armado de red y el contenedor queda
	 * sin puertos, pero `compose up -d` sale 0 y el síntoma aparece mucho después y lejos. Sólo
	 * avisa: el puerto puede liberarse solo y el resto de la infra no tiene por qué caerse.
	 */
	async #warnOnBusyPorts(dockerComposeFile: string, name: string): Promise<void> {
		let declared: PublishedPort[];
		try {
			declared = DockerManager.#parsePublishedPorts(await fs.readFile(dockerComposeFile, "utf8"));
		} catch {
			return; // El compose ya se valida con `fs.stat` en el caller.
		}
		if (declared.length === 0) return;
		const published = this.#dockerPublishedPorts();
		const busy = (await Promise.all(declared.map(async (p) => ((await DockerManager.#portInUse(p)) ? p : null)))).filter(
			(p): p is PublishedPort => p !== null && !published.has(p.port)
		);
		for (const { host, port } of busy) {
			this.#logger.logWarn(
				`[${name}] el puerto ${host}:${port} ya está ocupado por otro proceso del host. ` +
					`Docker no va a poder publicarlo y el contenedor puede quedar arriba pero sin red.`
			);
		}
	}

	/** Guard de los métodos que hacen spawn. Los puntos de entrada ya hacen no‑op antes de llegar acá. */
	#requireDocker(): string {
		if (!this.#dockerPath) throw new Error("Docker no está instalado en este host: no se puede ejecutar docker compose.");
		return this.#dockerPath;
	}

	/**
	 * Inicia docker-compose para una app específica.
	 */
	async startDockerCompose(appDir: string, appName: string): Promise<void> {
		// Sin docker es un no‑op silencioso: el aviso ya se emitió una vez al construir el manager,
		// y avisar por app/servicio llenaría el boot de ruido idéntico.
		if (!this.#dockerPath) return;
		try {
			await this.runDockerCompose(appDir, appName, "app");
		} catch (error: any) {
			if (error.code !== "ENOENT") {
				this.#logger.logWarn(`No se pudo ejecutar docker-compose: ${error.message}`);
			}
		}
	}

	/**
	 * Inicia docker-compose para un servicio kernel específico.
	 */
	async startServiceDockerCompose(serviceDir: string, serviceName: string): Promise<void> {
		if (!this.#dockerPath) return;
		try {
			await this.runDockerCompose(serviceDir, serviceName, "service");
		} catch (error: any) {
			if (error.code !== "ENOENT") {
				this.#logger.logDebug(`docker-compose no disponible para ${serviceName}`);
			}
		}
	}

	/**
	 * Detiene docker-compose en el directorio especificado.
	 *
	 * `graceSeconds` es lo que espera docker entre el SIGTERM y el SIGKILL a cada contenedor. El
	 * default de `docker compose down` son **10 s**, que alcanzan para un servicio sin estado y no
	 * para uno que tiene que cerrar archivos: un `mongod` o un Garage matados a mitad de un flush
	 * quedan necesitando recuperación. Los stacks con datos pasan un valor propio.
	 */
	async stopDockerCompose(appDir: string, graceSeconds?: number): Promise<void> {
		// Sin docker nunca se levantó nada, así que no hay nada que bajar.
		if (!this.#dockerPath) return;
		const dockerPath = this.#dockerPath;
		const dockerComposeFile = path.join(appDir, "docker-compose.yml");
		try {
			await fs.stat(dockerComposeFile);

			this.#logger.logInfo(`Deteniendo servicios Docker para app en ${appDir}...`);

			const args = ["compose", "-f", dockerComposeFile, "down"];
			if (graceSeconds !== undefined) args.push("--timeout", String(Math.max(1, Math.round(graceSeconds))));

			const { spawn } = await import("node:child_process");
			const docker = spawn(dockerPath, args, {
				cwd: appDir,
				stdio: "pipe",
			});

			return new Promise((resolve, reject) => {
				let output = "";
				docker.stdout?.on("data", (data) => {
					output += data.toString();
				});
				docker.stderr?.on("data", (data) => {
					output += data.toString();
				});
				docker.on("close", (code) => {
					if (code === 0) {
						this.#logger.logOk("Servicios Docker detenidos");
						resolve();
					} else {
						this.#logger.logWarn(`docker-compose down falló con código ${code}`);
						reject(new Error(`docker-compose exit code: ${code}`));
					}
				});
			});
		} catch (error: any) {
			if (error.code !== "ENOENT") {
				this.#logger.logWarn(`No se pudo detener docker-compose: ${error.message}`);
			}
		}
	}

	/**
	 * Verifica si una app tiene docker-compose configurado.
	 */
	hasAppDockerCompose(appBaseName: string): boolean {
		return this.#appDockerComposeMap.has(appBaseName);
	}

	/**
	 * Obtiene el directorio de docker-compose de una app.
	 */
	getAppDockerComposeDir(appBaseName: string): string | undefined {
		return this.#appDockerComposeMap.get(appBaseName);
	}

	/**
	 * Elimina el registro de docker-compose de una app.
	 */
	deleteAppDockerCompose(appBaseName: string): void {
		this.#appDockerComposeMap.delete(appBaseName);
	}

	/**
	 * Verifica si un servicio tiene docker-compose configurado.
	 */
	hasServiceDockerCompose(serviceName: string): boolean {
		return this.#serviceDockerComposeMap.has(serviceName);
	}

	/**
	 * Obtiene el directorio de docker-compose de un servicio.
	 */
	getServiceDockerComposeDir(serviceName: string): string | undefined {
		return this.#serviceDockerComposeMap.get(serviceName);
	}

	/**
	 * Elimina el registro de docker-compose de un servicio.
	 */
	deleteServiceDockerCompose(serviceName: string): void {
		this.#serviceDockerComposeMap.delete(serviceName);
	}

	/**
	 * Carga y ejecuta todos los docker-compose comunes desde un directorio.
	 * Lee las subcarpetas y ejecuta docker-compose.yml en cada una.
	 */
	async loadCommonDockerCompose(dockerDir: string): Promise<void> {
		// Acá sí conviene un warn: los comunes son mongo/redis/minio/…; sin ellos los providers
		// van a fallar al conectar y el operador tiene que entender por qué.
		if (!this.#dockerPath) {
			this.#logger.logWarn("Docker no disponible: se omiten los contenedores comunes (mongo, redis, minio, ...).");
			return;
		}
		try {
			const entries = await fs.readdir(dockerDir, { withFileTypes: true });
			const all = entries.filter((e) => e.isDirectory());

			// Un nodo secundario NO debe levantar su propio Mongo/Redis/S3: apuntaría a una base
			// vacía y paralela sin que nada avise. `ADC_INFRA_COMPOSE` acota qué stacks son suyos;
			// sin la variable se levanta todo, que es el comportamiento de un despliegue de un nodo.
			// En producción, `selection` sale del estado persistido del nodo (lo que se eligió en el
			// panel) y NO del entorno: la topología de un nodo tiene que sobrevivir a un reinicio y a
			// que alguien copie el `.env` de otra máquina.
			const selection = effectiveInfraSelection();
			const folders = all.filter((e) => shouldRunInfraCompose(e.name, selection));
			const skipped = all.filter((e) => !folders.includes(e)).map((e) => e.name);
			if (skipped.length > 0) {
				const source = isRealProduction() ? "el estado del nodo" : "ADC_INFRA_COMPOSE";
				this.#logger.logInfo(`Contenedores comunes omitidos por ${source} (${selection ?? "todos"}): ${skipped.join(", ")}`);
			}

			if (folders.length === 0) {
				this.#logger.logDebug("No hay contenedores comunes para cargar");
				return;
			}

			this.#logger.logInfo(`Cargando ${folders.length} contenedor(es) común(es) en paralelo...`);

			// Los contenedores comunes son independientes entre sí, por lo que se arrancan en
			// paralelo. allSettled (no all) preserva que el fallo de uno no aborte a los demás.
			await Promise.allSettled(
				folders.map(async (folder) => {
					const folderPath = path.join(dockerDir, folder.name);
					const composePath = path.join(folderPath, "docker-compose.yml");

					try {
						await fs.stat(composePath);
						await this.runDockerCompose(folderPath, folder.name, "common");
					} catch (error: any) {
						if (error.code === "ENOENT") {
							this.#logger.logDebug(`[${folder.name}] No hay docker-compose.yml`);
						} else {
							this.#logger.logWarn(`[${folder.name}] Error cargando contenedor común: ${error.message}`);
						}
					}
				}),
			);
		} catch (error: any) {
			if (error.code === "ENOENT") {
				this.#logger.logDebug(`Directorio de docker común no existe: ${dockerDir}`);
			} else {
				this.#logger.logWarn(`Error leyendo directorio docker común: ${error.message}`);
			}
		}
	}

	/**
	 * Detiene todos los contenedores comunes, **uno por vez y en el orden pedido**.
	 *
	 * Secuencial y no en paralelo (al revés que el arranque) porque acá el orden importa: bajar la
	 * base de datos antes que sus consumidores los deja escribiendo contra algo que ya no está.
	 *
	 * El presupuesto es **por stack** y no para el conjunto: `docker compose down` ya tiene 10 s de
	 * gracia por contenedor, así que un reloj común saltaría siempre y el SIGKILL a `mongod` sería la
	 * regla. Los que se pasan se **abandonan pero no se olvidan**: quedan en el mapa y se reportan.
	 */
	async stopAllCommonDockerCompose(opts: { order?: string[]; timeoutMsPerStack?: number } = {}): Promise<void> {
		const { order = [], timeoutMsPerStack = 180_000 } = opts;
		// Lo declarado primero, en ese orden; después lo que no figure, como haya quedado.
		const declared = order.filter((name) => this.#commonDockerComposeMap.has(name));
		const rest = [...this.#commonDockerComposeMap.keys()].filter((name) => !declared.includes(name));
		const graceSeconds = Math.max(10, Math.floor(timeoutMsPerStack / 1000) - 5);

		for (const name of [...declared, ...rest]) {
			const dir = this.#commonDockerComposeMap.get(name);
			if (!dir) continue;
			const startedAt = Date.now();
			try {
				const timedOut = await this.#withStackTimeout(this.stopDockerCompose(dir, graceSeconds), timeoutMsPerStack, name);
				if (timedOut) continue;
				this.#commonDockerComposeMap.delete(name);
				this.#logger.logOk(`[${name}] detenido en ${Date.now() - startedAt}ms`);
			} catch (error: any) {
				this.#logger.logWarn(`Error deteniendo contenedor común ${name}: ${error.message}`);
				this.#commonDockerComposeMap.delete(name);
			}
		}
	}

	/**
	 * Espera a que un stack termine de bajar, avisando cada 10 s de que sigue en eso.
	 *
	 * El aviso periódico no es cosmético: un cierre limpio de Mongo puede tardar, y sin señales de
	 * vida el operador asume que se colgó y lo mata a mano — que es exactamente lo que este cambio
	 * viene a evitar. Devuelve `true` si venció el presupuesto.
	 */
	async #withStackTimeout(promise: Promise<void>, timeoutMs: number, name: string): Promise<boolean> {
		let ticker: ReturnType<typeof setInterval> | undefined;
		let timer: ReturnType<typeof setTimeout> | undefined;
		const startedAt = Date.now();
		try {
			const timedOut = await Promise.race([
				promise.then(() => false),
				new Promise<boolean>((resolve) => {
					ticker = setInterval(() => {
						this.#logger.logInfo(`[${name}] cerrando... (${Math.round((Date.now() - startedAt) / 1000)}s)`);
					}, 10_000);
					ticker.unref?.();
					timer = setTimeout(() => resolve(true), timeoutMs);
				}),
			]);
			if (timedOut) {
				this.#logger.logWarn(`[${name}] no terminó de cerrar en ${timeoutMs}ms: se deja corriendo en vez de matarlo a mitad de una escritura.`);
			}
			return timedOut;
		} finally {
			if (ticker) clearInterval(ticker);
			if (timer) clearTimeout(timer);
		}
	}

	/**
	 * Verifica si un contenedor común tiene docker-compose configurado.
	 */
	hasCommonDockerCompose(name: string): boolean {
		return this.#commonDockerComposeMap.has(name);
	}

	/**
	 * Obtiene el directorio de docker-compose de un contenedor común.
	 */
	getCommonDockerComposeDir(name: string): string | undefined {
		return this.#commonDockerComposeMap.get(name);
	}

	/**
	 * Enumera los composes efectivamente levantados en esta corrida. Son los únicos contenedores
	 * que el kernel administra: los módulos NO corren en contenedores (se cargan in‑process), así
	 * que esta lista es infra externa, no "el contenedor del módulo X".
	 */
	listComposeTargets(): ComposeTarget[] {
		const groups: Array<[ComposeTarget["type"], Map<string, string>]> = [
			["common", this.#commonDockerComposeMap],
			["service", this.#serviceDockerComposeMap],
			["app", this.#appDockerComposeMap],
		];
		return groups.flatMap(([type, map]) => Array.from(map, ([name, dir]) => ({ type, name, dir })));
	}

	/** `true` si se encontró el binario de docker al arrancar. */
	dockerAvailable(): boolean {
		return this.#dockerPath !== null;
	}

	/** Ruta del binario de docker, o `null` si no está instalado. */
	dockerPath(): string | null {
		return this.#dockerPath;
	}
}
