#!/usr/bin/env node
/**
 * setup-node-host.mjs — deja ESTA máquina lista para correr un nodo: Docker en marcha, `bun`
 * instalado, dependencias del repo bajadas.
 *
 *   sudo node scripts/setup-node-host.mjs [--dry-run] [--skip-install] [--skip-deps]
 *
 * **No toca secretos ni configuración**: no escribe nada en `env/`, no registra la máquina y no
 * arranca la plataforma. Corre DESPUÉS de clonar el repo y ANTES del alta por token; el orden
 * completo del trámite está en la guía de alta de nodo.
 *
 * Todas las ejecuciones van por `execFileSync` con argumentos en array y `PATH` fijo, nunca por shell.
 */

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, copyFileSync, existsSync, mkdtempSync, readFileSync, renameSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const SAFE_PATH = "/usr/bin:/bin:/usr/sbin:/sbin:/usr/local/bin";

/**
 * Versión de bun que se instala, con el hash de cada binario oficial.
 *
 * Se baja el zip del release y no se corre `curl https://bun.sh/install | bash`: un archivo con su
 * SHA-256 publicado es menos superficie que un shell script como root, y además queda en
 * `/usr/local/bin` en vez del `~/.bun` de quien haya hecho sudo.
 *
 * Para actualizar: cambiar la versión y pegar los hashes de
 * `https://github.com/oven-sh/bun/releases/download/bun-v<versión>/SHASUMS256.txt`.
 */
const BUN_VERSION = "1.3.14";
const BUN_SHA256 = {
	"bun-linux-x64.zip": "951ee2aee855f08595aeec6225226a298d3fea83a3dcd6465c09cbccdf7e848f",
	"bun-linux-x64-baseline.zip": "a063908ae08b7852ca10939bbdc6ceed3ddabce8fb9402dce83d65d73b36e6c7",
	"bun-linux-aarch64.zip": "a27ffb63a8310375836e0d6f668ae17fa8d8d18b88c37c821c65331973a19a3b",
};
const BUN_TARGET = "/usr/local/bin/bun";

const c = {
	reset: "[0m",
	bold: "[1m",
	dim: "[2m",
	red: "[31m",
	green: "[32m",
	yellow: "[33m",
	cyan: "[36m",
};

function fail(message) {
	console.error(`${c.red}✗${c.reset} ${message}`);
	process.exit(1);
}

function parseArgs(argv) {
	const args = { dryRun: false, skipInstall: false, skipDeps: false };
	for (const arg of argv) {
		if (arg === "--dry-run") args.dryRun = true;
		else if (arg === "--skip-install") args.skipInstall = true;
		else if (arg === "--skip-deps") args.skipDeps = true;
		else if (arg === "--help" || arg === "-h") args.help = true;
		else fail(`Argumento desconocido: ${arg}`);
	}
	return args;
}

function printHelp() {
	console.log(`${c.bold}setup-node-host${c.reset} — deja esta máquina lista para correr un nodo.

Uso (como root, desde la raíz del repo ya clonado):
  sudo node scripts/setup-node-host.mjs

Qué hace, en orden:
  1. Instala Docker (motor + plugin compose) con el gestor de paquetes de la distro.
  2. Levanta y habilita el demonio, y suma al usuario al grupo 'docker'.
  3. Instala bun ${BUN_VERSION} en ${BUN_TARGET}, verificando el SHA-256 del binario oficial.
  4. Corre 'bun install' en el repo, como su dueño (nunca como root).
  5. Comprueba las tres cosas y dice cuál falta.

Opciones:
  --skip-install   No instalar nada: sólo comprobar y bajar dependencias.
  --skip-deps      No correr 'bun install'.
  --dry-run        Mostrar qué haría, sin ejecutar nada.

No toca 'env/', no arranca la plataforma y no registra la máquina en ningún lado.`);
}

function run(bin, args, { capture = false, allowFail = false, cwd, uid, gid, env } = {}) {
	try {
		const out = execFileSync(bin, args, {
			cwd,
			uid,
			gid,
			env: { ...process.env, ...env, PATH: SAFE_PATH, DEBIAN_FRONTEND: "noninteractive" },
			stdio: capture ? ["ignore", "pipe", "pipe"] : "inherit",
			encoding: "utf-8",
			timeout: 900_000,
		});
		return { ok: true, out: capture ? String(out) : "" };
	} catch (error) {
		if (!allowFail) fail(`Falló \`${bin} ${args.join(" ")}\`: ${error.message}`);
		return { ok: false, out: "" };
	}
}

function which(bin) {
	for (const dir of SAFE_PATH.split(":")) {
		if (existsSync(`${dir}/${bin}`)) return `${dir}/${bin}`;
	}
	return null;
}

/**
 * Gestor de paquetes de la distro y **cómo se llama Docker en ella** (los nombres no coinciden entre
 * distros). Se detecta por el binario del gestor y no por `/etc/os-release`, igual que en
 * `setup-node-vpn.mjs`: hay demasiadas derivadas declarando el `ID` del padre.
 */
function detectPackageManager() {
	if (which("apt-get")) {
		return {
			name: "apt",
			update: ["apt-get", ["update", "-qq"]],
			install: (pkgs) => ["apt-get", ["install", "-y", "-qq", ...pkgs]],
			docker: ["docker.io", "docker-compose-v2"],
		};
	}
	if (which("dnf")) return { name: "dnf", update: null, install: (p) => ["dnf", ["install", "-y", ...p]], docker: ["docker", "docker-compose-plugin"] };
	if (which("pacman")) return { name: "pacman", update: null, install: (p) => ["pacman", ["-Sy", "--noconfirm", ...p]], docker: ["docker", "docker-compose"] };
	if (which("zypper")) return { name: "zypper", update: null, install: (p) => ["zypper", ["--non-interactive", "install", ...p]], docker: ["docker", "docker-compose"] };
	if (which("apk")) return { name: "apk", update: null, install: (p) => ["apk", ["add", "--no-cache", ...p]], docker: ["docker", "docker-cli-compose"] };
	if (which("yum")) return { name: "yum", update: null, install: (p) => ["yum", ["install", "-y", ...p]], docker: ["docker", "docker-compose-plugin"] };
	return null;
}

// ── Docker ──────────────────────────────────────────────────────────────────────

/** `docker compose` (plugin v2) responde. Es lo que usa el kernel; `docker-compose` v1 no sirve. */
function hasComposeV2() {
	const docker = which("docker");
	if (!docker) return false;
	return run(docker, ["compose", "version"], { capture: true, allowFail: true }).ok;
}

function installDocker(pm, dryRun) {
	if (which("docker") && hasComposeV2()) {
		console.log(`${c.dim}Docker y el plugin compose ya están instalados.${c.reset}`);
		return;
	}
	console.log(`${c.cyan}▶${c.reset} Instalando Docker con ${pm.name} ${c.dim}(${pm.docker.join(", ")})${c.reset}…`);
	const [bin, args] = pm.install(pm.docker);
	if (dryRun) {
		if (pm.update) console.log(`  ${c.dim}(dry-run) ${pm.update[0]} ${pm.update[1].join(" ")}${c.reset}`);
		console.log(`  ${c.dim}(dry-run) ${bin} ${args.join(" ")}${c.reset}`);
		return;
	}
	if (pm.update) run(pm.update[0], pm.update[1]);
	run(bin, args);
}

/**
 * Deja el demonio corriendo **y habilitado al arranque**: un nodo que vuelve de un corte con el
 * demonio parado levanta el kernel sin ninguno de sus motores, y eso se lee como «la plataforma anda
 * mal» y no como «falta un `systemctl enable`».
 */
function startDocker(dryRun) {
	const systemctl = which("systemctl");
	if (!systemctl) {
		console.log(`${c.yellow}⚠${c.reset} Sin systemd: arrancá el demonio de Docker como corresponda en esta distro y comprobá que quede habilitado al arranque.`);
		return;
	}
	if (dryRun) return console.log(`  ${c.dim}(dry-run) systemctl enable --now docker${c.reset}`);
	run(systemctl, ["enable", "--now", "docker"], { allowFail: true });
}

/**
 * Suma al dueño del repo al grupo `docker`: el kernel llama a `docker` como el usuario que lo corre,
 * así que sin esto todo `docker compose up` falla con permiso denegado sobre el socket. Se avisa en
 * voz alta porque el grupo `docker` equivale a root en la práctica.
 */
function joinDockerGroup(user, dryRun) {
	if (!user || user === "root") return;
	const usermod = which("usermod");
	if (!usermod) return;
	console.log(`${c.cyan}▶${c.reset} Agregando a '${user}' al grupo docker…`);
	console.log(`  ${c.yellow}Ojo: pertenecer al grupo 'docker' equivale a tener root en esta máquina.${c.reset}`);
	if (dryRun) return console.log(`  ${c.dim}(dry-run) usermod -aG docker ${user}${c.reset}`);
	const { ok } = run(usermod, ["-aG", "docker", user], { allowFail: true });
	if (ok) console.log(`  ${c.dim}Hace falta cerrar y volver a abrir la sesión de '${user}' para que tome el grupo.${c.reset}`);
}

// ── bun ─────────────────────────────────────────────────────────────────────────

/**
 * Qué binario de bun corresponde a este procesador. La variante `baseline` es para CPUs sin AVX2: el
 * binario normal en una de ésas no falla al instalarse sino al ejecutarse, con un «illegal
 * instruction» que no dice nada.
 */
function bunAsset() {
	if (process.arch === "arm64") return "bun-linux-aarch64.zip";
	if (process.arch !== "x64") return null;
	let flags = "";
	try {
		flags = readFileSync("/proc/cpuinfo", "utf-8");
	} catch {
		// Sin poder mirar, la variante conservadora: corre en todos lados, sólo un poco más lenta.
		return "bun-linux-x64-baseline.zip";
	}
	return /\bavx2\b/.test(flags) ? "bun-linux-x64.zip" : "bun-linux-x64-baseline.zip";
}

function installBun(dryRun) {
	const existing = which("bun");
	if (existing) {
		const { out } = run(existing, ["--version"], { capture: true, allowFail: true });
		console.log(`${c.dim}bun ya está instalado (${out.trim() || "versión desconocida"}) en ${existing}.${c.reset}`);
		return;
	}
	const asset = bunAsset();
	if (!asset) fail(`No hay binario oficial de bun para esta arquitectura (${process.arch}). Instalalo a mano y volvé con \`--skip-install\`.`);
	const url = `https://github.com/oven-sh/bun/releases/download/bun-v${BUN_VERSION}/${asset}`;
	const expected = BUN_SHA256[asset];

	console.log(`${c.cyan}▶${c.reset} Instalando bun ${BUN_VERSION} ${c.dim}(${asset})${c.reset}…`);
	if (dryRun) {
		console.log(`  ${c.dim}(dry-run) curl -fsSL ${url} -o <dir temporal privado>/${asset}${c.reset}`);
		console.log(`  ${c.dim}(dry-run) verificar sha256 == ${expected.slice(0, 16)}… y recién entonces instalar en ${BUN_TARGET}${c.reset}`);
		return;
	}
	const curl = which("curl");
	if (!curl) fail("Hace falta `curl` para bajar bun. Instalalo y volvé a correr.");
	const unzip = which("unzip");
	if (!unzip) fail("Hace falta `unzip` para descomprimir el release de bun. Instalalo y volvé a correr.");

	// Directorio propio con permisos 0700 y no un nombre fijo en /tmp: esto corre como root, y un
	// nombre predecible lo puede pre-crear como symlink cualquier usuario sin privilegios.
	const dir = mkdtempSync(join(tmpdir(), "adc-host-"));
	try {
		const zip = join(dir, asset);
		run(curl, ["-fsSL", url, "-o", zip]);
		const actual = createHash("sha256").update(readFileSync(zip)).digest("hex");
		if (actual !== expected) {
			fail(
				`El binario de bun descargado no coincide con el hash publicado.\n` +
					`  esperado: ${expected}\n  recibido: ${actual}\n` +
					`No se instaló nada. Puede ser una descarga corrupta o manipulada: volvé a intentar y, si persiste, revisá el release a mano.`
			);
		}
		console.log(`  ${c.green}✓${c.reset} Binario verificado ${c.dim}(sha256 ${actual.slice(0, 16)}…)${c.reset}`);
		run(unzip, ["-q", "-o", zip, "-d", dir]);
		const extracted = join(dir, asset.replace(/\.zip$/, ""), "bun");
		if (!existsSync(extracted)) fail(`El zip de bun no trajo el binario donde se esperaba (${extracted}).`);
		// Se copia a un temporal AL LADO del destino y se renombra: `rename(2)` no cruza sistemas de
		// archivos y /tmp suele ser un tmpfs aparte (EXDEV). El rename además evita el ETXTBSY de
		// escribir encima de un binario en uso.
		const staged = join(dirname(BUN_TARGET), ".bun.incoming");
		copyFileSync(extracted, staged);
		chmodSync(staged, 0o755);
		renameSync(staged, BUN_TARGET);
		console.log(`  ${c.green}✓${c.reset} bun ${BUN_VERSION} en ${BUN_TARGET}`);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}

// ── Dependencias del repo ───────────────────────────────────────────────────────

function repoRoot() {
	return resolve(dirname(fileURLToPath(import.meta.url)), "..");
}

/**
 * `bun install` **como el dueño del repo**, no como root: con sudo, `node_modules` y la caché quedan
 * de root y el usuario que corre la plataforma no puede reinstalar nada nunca más. Node pasa
 * `uid`/`gid` al hijo, así que no hace falta ningún `su`.
 */
function installDeps(root, owner, dryRun) {
	const bun = which("bun") ?? BUN_TARGET;
	console.log(`${c.cyan}▶${c.reset} Bajando dependencias del repo ${c.dim}(${root})${c.reset}…`);
	console.log(`  ${c.dim}Corre además el postinstall, que sincroniza los presets. Puede tardar varios minutos.${c.reset}`);
	if (dryRun) return console.log(`  ${c.dim}(dry-run) bun install  (como ${owner.name}, en ${root})${c.reset}`);
	if (!existsSync(bun)) fail("bun no quedó instalado: revisá la salida de arriba, o volvé a correr con `--skip-deps`.");
	// Bajar de usuario sólo se puede desde root; corriendo ya como el dueño, no hay a quién bajar.
	const asOwner = process.getuid?.() === 0 ? { uid: owner.uid, gid: owner.gid } : {};
	run(bun, ["install"], {
		cwd: root,
		...asOwner,
		// bun escribe su caché en $HOME; con el HOME de root, el dueño no la podría reusar después.
		env: { HOME: owner.home, USER: owner.name },
	});
}

/**
 * Dueño del repo, que es quien va a correr la plataforma. Se deduce del directorio y no de
 * `SUDO_USER`: lo que importa es de quién son los archivos, no desde qué cuenta se hizo sudo.
 */
function repoOwner(root) {
	const { uid, gid } = statSync(root);
	if (uid === 0) return { uid: 0, gid: 0, name: "root", home: "/root" };
	let name = process.env.SUDO_USER ?? String(uid);
	let home = `/home/${name}`;
	try {
		const line = readFileSync("/etc/passwd", "utf-8")
			.split("\n")
			.find((l) => Number(l.split(":")[2]) === uid);
		if (line) {
			const parts = line.split(":");
			name = parts[0];
			home = parts[5] || home;
		}
	} catch {
		// Sin /etc/passwd legible queda el uid numérico, que alcanza para ejecutar.
	}
	return { uid, gid, name, home };
}

// ── Verificación ────────────────────────────────────────────────────────────────

function verify(dryRun) {
	if (dryRun) return true;
	const docker = which("docker");
	const rows = [
		{
			title: "El demonio de Docker responde",
			ok: docker !== null && run(docker, ["info"], { capture: true, allowFail: true }).ok,
			hint: "`docker info` falla: el demonio no está corriendo, o falta cerrar sesión para tomar el grupo docker.",
		},
		{
			title: "El plugin `docker compose` existe",
			ok: hasComposeV2(),
			hint: "El kernel levanta su infraestructura con `docker compose`; el `docker-compose` v1 no sirve. Instalá el plugin de tu distro.",
		},
		{
			title: "bun está en el PATH del sistema",
			ok: which("bun") !== null,
			// Lo habitual no es que falte, sino que esté en el `~/.bun/bin` del instalador oficial:
			// alcanza para una sesión interactiva y no para un servicio, que arranca con un PATH
			// mínimo y falla con «command not found» recién en el reinicio siguiente.
			hint: `bun no está en ${SAFE_PATH.replaceAll(":", ", ")}. Si lo instalaste en ~/.bun/bin, o lo movés a ${BUN_TARGET} o el supervisor que arranque la plataforma tiene que llevar ese directorio en su PATH.`,
		},
	];

	const tick = `${c.green}✓${c.reset}`;
	const cross = `${c.red}✗${c.reset}`;
	console.log(`\n${c.bold}Comprobación${c.reset}`);
	for (const { title, ok, hint } of rows) {
		console.log(`  ${ok ? tick : cross} ${title}`);
		if (!ok) console.log(`    ${c.dim}${hint}${c.reset}`);
	}
	return rows.every((r) => r.ok);
}

function main() {
	const args = parseArgs(process.argv.slice(2));
	if (args.help) return printHelp();

	if (process.platform !== "linux") fail("Este script es para Linux. En otro sistema, instalá Docker y bun a mano.");
	// Sólo la instalación necesita privilegios: con `--skip-install` esto es sólo una comprobación de
	// lectura.
	if (!args.dryRun && !args.skipInstall && typeof process.getuid === "function" && process.getuid() !== 0) {
		fail("Hay que correrlo como root (instala paquetes y habilita un demonio): usá `sudo`. Para sólo comprobar, `--skip-install --skip-deps`.");
	}
	const root = repoRoot();
	if (!existsSync(join(root, "package.json"))) fail(`No parece la raíz del repo (${root}): falta package.json. Corré el script desde el clon.`);
	const owner = repoOwner(root);

	console.log(`${c.bold}${c.cyan}Preparación de esta máquina para correr un nodo${c.reset}`);
	console.log(`${c.dim}Repo: ${root} (dueño: ${owner.name})${c.reset}`);
	if (args.dryRun) console.log(`${c.yellow}Modo dry-run: no se ejecuta nada.${c.reset}`);
	console.log("");

	if (args.skipInstall) {
		console.log(`${c.dim}--skip-install: se salta la instalación.${c.reset}`);
	} else {
		const pm = detectPackageManager();
		if (!pm) fail("No se reconoció el gestor de paquetes (apt/dnf/yum/pacman/zypper/apk). Instalá Docker y bun a mano y volvé con `--skip-install`.");
		installDocker(pm, args.dryRun);
		startDocker(args.dryRun);
		joinDockerGroup(owner.name, args.dryRun);
		installBun(args.dryRun);
	}

	if (args.skipDeps) console.log(`${c.dim}--skip-deps: no se corre bun install.${c.reset}`);
	else installDeps(root, owner, args.dryRun);

	const ok = verify(args.dryRun);
	if (ok === false) {
		console.log(`\n${c.yellow}${c.bold}Quedó algo pendiente.${c.reset} Resolvé lo marcado arriba antes de seguir con el alta.`);
		process.exit(1);
	}

	console.log(`\n${c.green}${c.bold}Listo.${c.reset} La máquina tiene lo que hace falta para correr un nodo.`);
	console.log(`${c.dim}Siguiente paso: meterla en la red privada con \`sudo node scripts/setup-node-vpn.mjs\` —el panel de red da el comando ya armado— y`);
	console.log(`después pegar el bloque de env/host.env que ese mismo panel entrega.${c.reset}`);
}

main();
