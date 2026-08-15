#!/usr/bin/env node
/**
 * setup-node-vpn.mjs — mete ESTA máquina en la red privada de la plataforma.
 *
 * Corre en el host nuevo, como root, y **fuera del kernel**: es lo primero que se hace en una
 * máquina virgen, antes de que exista un despliegue que pueda hacerlo solo. Ver
 * [docs/guides/network-vpn.md](../docs/guides/network-vpn.md).
 *
 *   sudo node scripts/setup-node-vpn.mjs \
 *     --setup-key <clave del panel> \
 *     --management-url https://vpn.midominio.com:33443 \
 *     [--hostname torre] [--dry-run] [--skip-install]
 *
 * No toca el `.env` ni configura la plataforma: eso lo hace el alta por token, que viaja por la
 * overlay y necesita esta parte hecha.
 *
 * Todas las ejecuciones van por `execFileSync` con argumentos en array y `PATH` fijo, nunca por
 * shell: la clave de alta y la URL jamás se interpolan en una línea de comandos.
 */

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";

const SAFE_PATH = "/usr/bin:/bin:/usr/sbin:/sbin:/usr/local/bin";
/** Instalador oficial del agente. Es el único código de terceros que este script ejecuta. */
const AGENT_INSTALLER_URL = "https://pkgs.netbird.io/install.sh";
/**
 * SHA-256 del instalador que se revisó y se aprobó. **Es el único control sobre lo que este script
 * ejecuta como root**; sin él la única garantía sería el TLS de la descarga.
 *
 * Que se rompa cuando NetBird publique una versión nueva es lo buscado: obliga a mirar el diff antes
 * de correrlo con privilegios. Para actualizarlo, ver el mensaje de error o pasar
 * `--installer-sha256 <hash>` para una corrida puntual.
 *
 * Revisado el 2026-08-14 (14924 bytes).
 */
const AGENT_INSTALLER_SHA256 = "991b90c45053fcdd7aa1dccd468403aea29ac8f2f57a9398515d5a4e87628828";
const c = {
	reset: "\u001b[0m",
	bold: "\u001b[1m",
	dim: "\u001b[2m",
	red: "\u001b[31m",
	green: "\u001b[32m",
	yellow: "\u001b[33m",
	cyan: "\u001b[36m",
};

/** Sólo lo que la overlay puede aceptar: https y un host, sin credenciales embebidas. */
const URL_RE = /^https:\/\/[a-zA-Z0-9.-]+(:\d{1,5})?\/?$/;
/** Formato de las claves de alta: un UUID. Validarlo evita pegar por error otra cosa. */
const KEY_RE = /^[0-9A-Fa-f-]{30,60}$/;
/** Nombre del host dentro de la overlay: el mismo slug que valida `cluster-env` para el nodo. */
const HOSTNAME_RE = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,62}$/;

function fail(message) {
	console.error(`${c.red}✗${c.reset} ${message}`);
	process.exit(1);
}

function parseArgs(argv) {
	const args = { dryRun: false, skipInstall: false, quantum: true };
	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		if (arg === "--dry-run") args.dryRun = true;
		else if (arg === "--skip-install") args.skipInstall = true;
		else if (arg === "--no-quantum-resistance") args.quantum = false;
		else if (arg === "--help" || arg === "-h") args.help = true;
		else if (arg === "--installer-sha256") args.installerSha256 = argv[++i];
		else if (arg === "--setup-key") args.setupKey = argv[++i];
		else if (arg === "--management-url") args.managementUrl = argv[++i];
		else if (arg === "--hostname") args.hostname = argv[++i];
		else fail(`Argumento desconocido: ${arg}`);
	}
	return args;
}

function printHelp() {
	console.log(`${c.bold}setup-node-vpn${c.reset} — mete esta máquina en la red privada de la plataforma.

Uso (como root):
  sudo node scripts/setup-node-vpn.mjs --setup-key <clave> --management-url https://<host>:<puerto>

Opciones:
  --setup-key <clave>       Clave de alta. Se crea en el panel de red, tab "Red privada".
  --management-url <url>    Dirección pública del plano de control (https, con su puerto).
  --hostname <nombre>       Nombre del host dentro de la red. Por defecto, el del sistema.
  --skip-install            No instalar nada: sólo registrar (para una máquina que ya tiene el agente).
  --installer-sha256 <hash> Aceptar ESTE hash del instalador oficial en vez del aprobado en el script.
                            Sólo después de revisar el diff: lo que se ejecuta, se ejecuta como root.
  --no-quantum-resistance   Registrar SIN Rosenpass. Ver abajo antes de usarlo.
  --dry-run                 Mostrar qué haría, sin ejecutar nada.

Por defecto se registra con resistencia cuántica (Rosenpass), en modo permisivo: rota la clave
compartida de WireGuard cada dos minutos con criptografía post-cuántica, y los peers que no la
soporten —los móviles, entre otros— siguen conectando con WireGuard normal.

La clave de alta es un secreto: quien la tenga mete una máquina en la red privada. El panel las
crea de un solo uso y con vigencia corta por ese motivo — no la reutilices ni la dejes en un chat.`);
}

function run(bin, args, { capture = false, allowFail = false } = {}) {
	try {
		const out = execFileSync(bin, args, {
			env: { ...process.env, PATH: SAFE_PATH, DEBIAN_FRONTEND: "noninteractive" },
			stdio: capture ? ["ignore", "pipe", "pipe"] : "inherit",
			encoding: "utf-8",
			timeout: 600_000,
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
 * Gestor de paquetes de la distro. Se detecta por el binario y no por `/etc/os-release`: hay
 * demasiadas derivadas declarando el `ID` del padre.
 */
function detectPackageManager() {
	if (which("apt-get")) {
		return { name: "apt", update: ["apt-get", ["update", "-qq"]], install: (pkgs) => ["apt-get", ["install", "-y", "-qq", ...pkgs]] };
	}
	if (which("dnf")) return { name: "dnf", update: null, install: (pkgs) => ["dnf", ["install", "-y", ...pkgs]] };
	if (which("yum")) return { name: "yum", update: null, install: (pkgs) => ["yum", ["install", "-y", ...pkgs]] };
	if (which("pacman")) return { name: "pacman", update: null, install: (pkgs) => ["pacman", ["-Sy", "--noconfirm", ...pkgs]] };
	if (which("zypper")) return { name: "zypper", update: null, install: (pkgs) => ["zypper", ["--non-interactive", "install", ...pkgs]] };
	if (which("apk")) return { name: "apk", update: null, install: (pkgs) => ["apk", ["add", "--no-cache", ...pkgs]] };
	return null;
}

function installWireguard(pm, dryRun) {
	if (which("wg")) {
		console.log(`${c.dim}WireGuard ya está instalado (wg).${c.reset}`);
		return;
	}
	// `wireguard-tools` alcanza y se llama igual en las seis distros: el módulo de kernel está en
	// Linux desde 5.6, y el agente cae solo a una implementación en espacio de usuario si no lo hay.
	console.log(`${c.cyan}▶${c.reset} Instalando WireGuard con ${pm.name}…`);
	const [bin, args] = pm.install(["wireguard-tools"]);
	if (dryRun) {
		if (pm.update) console.log(`  ${c.dim}(dry-run) ${pm.update[0]} ${pm.update[1].join(" ")}${c.reset}`);
		console.log(`  ${c.dim}(dry-run) ${bin} ${args.join(" ")}${c.reset}`);
		return;
	}
	if (pm.update) run(pm.update[0], pm.update[1]);
	run(bin, args);
}

/** El hash aprobado, o el que el operador pasó por flag tras revisar el instalador. */
function approvedInstallerHash(override) {
	if (!override) return AGENT_INSTALLER_SHA256;
	if (!/^[0-9a-f]{64}$/i.test(override)) fail("`--installer-sha256` tiene que ser un SHA-256 en hexadecimal (64 caracteres).");
	return override.toLowerCase();
}

/**
 * Único paso que descarga y ejecuta código de un tercero: el instalador oficial agrega el
 * repositorio de la distro y de ahí sale el paquete firmado. Empaquetar el binario en este repo
 * dejaría sus actualizaciones a nuestro cargo, que es peor para una pieza de red.
 */
function installAgent(dryRun, shaOverride) {
	const expectedSha256 = approvedInstallerHash(shaOverride);
	if (which("netbird")) {
		console.log(`${c.dim}El agente de la overlay ya está instalado.${c.reset}`);
		return;
	}
	console.log(`${c.cyan}▶${c.reset} Instalando el agente de la overlay…`);
	console.log(`  ${c.yellow}Esto descarga y ejecuta el instalador oficial de NetBird${c.reset} ${c.dim}(${AGENT_INSTALLER_URL})${c.reset}`);
	if (dryRun) {
		console.log(`  ${c.dim}(dry-run) curl -fsSL ${AGENT_INSTALLER_URL} -o <dir temporal privado>/install.sh${c.reset}`);
		console.log(`  ${c.dim}(dry-run) verificar sha256 == ${expectedSha256.slice(0, 16)}… y recién entonces ejecutarlo${c.reset}`);
		return;
	}
	const curl = which("curl");
	if (!curl) fail("Hace falta `curl` para bajar el instalador del agente. Instalalo y volvé a correr.");
	// Directorio 0700 y NO un nombre fijo en /tmp: esto corre como root, y un `/tmp/algo.sh`
	// predecible lo puede pre-crear como symlink cualquier usuario sin privilegios.
	const dir = mkdtempSync(join(tmpdir(), "adc-vpn-"));
	const installer = join(dir, "install.sh");
	let keep = false;
	try {
		// A un archivo y no `curl | sh`: hace falta el instalador completo para hashearlo ANTES de
		// ejecutarlo, y con la tubería ese momento no existe (sh interpreta los primeros bytes
		// mientras llegan los últimos).
		run(curl, ["-fsSL", AGENT_INSTALLER_URL, "-o", installer]);
		const actual = createHash("sha256").update(readFileSync(installer)).digest("hex");
		if (actual !== expectedSha256) {
			keep = true;
			console.error(
				`\n${c.red}✗ El instalador oficial no es el que este script tiene aprobado.${c.reset}\n\n` +
					`  esperado: ${c.dim}${expectedSha256}${c.reset}\n` +
					`  recibido: ${c.yellow}${actual}${c.reset}\n\n` +
					`Puede ser sólo que NetBird publicó una versión nueva —lo habitual— o que la descarga fue\n` +
					`manipulada. No hay forma de distinguirlo sin mirar, y esto se ejecuta como ${c.bold}root${c.reset}.\n\n` +
					`El archivo quedó en ${c.bold}${installer}${c.reset} para que lo revises:\n` +
					`  ${c.dim}less ${installer}${c.reset}\n\n` +
					`Si el contenido es legítimo, actualizá ${c.bold}AGENT_INSTALLER_SHA256${c.reset} en este script\n` +
					`(es lo correcto: queda versionado y revisado), o para una corrida puntual:\n` +
					`  ${c.dim}--installer-sha256 ${actual}${c.reset}`
			);
			process.exit(1);
		}
		console.log(`  ${c.green}✓${c.reset} Instalador verificado ${c.dim}(sha256 ${actual.slice(0, 16)}…)${c.reset}`);
		run(which("sh") ?? "/bin/sh", [installer]);
	} finally {
		// Se conserva sólo cuando hay algo que revisar; en el camino feliz no queda nada en /tmp.
		if (!keep) rmSync(dir, { recursive: true, force: true });
	}
}

/**
 * Resistencia cuántica del enlace, encendida por defecto (ver «Resistencia cuántica» en
 * [docs/guides/network-vpn.md](../docs/guides/network-vpn.md)). **Permisivo siempre**: sin el flag,
 * un peer que no soporte Rosenpass —cualquier móvil— directamente no conecta.
 */
const QUANTUM_FLAGS = ["--enable-rosenpass", "--rosenpass-permissive"];

function joinNetwork({ setupKey, managementUrl, hostname, quantum }, dryRun) {
	const bin = which("netbird");
	if (!bin && !dryRun) fail("El agente de la overlay no quedó instalado: revisá la salida de arriba.");
	const args = ["up", "--setup-key", setupKey, "--management-url", managementUrl];
	if (hostname) args.push("--hostname", hostname);
	if (quantum) args.push(...QUANTUM_FLAGS);

	console.log(`${c.cyan}▶${c.reset} Registrando este host en la red privada…`);
	if (quantum) {
		console.log(`  ${c.dim}Con resistencia cuántica (Rosenpass), en modo permisivo.${c.reset}`);
	} else {
		console.log(
			`  ${c.yellow}SIN resistencia cuántica.${c.reset} El tráfico de este enlace queda expuesto a que alguien lo\n` +
				`  ${c.yellow}grabe hoy y lo descifre cuando existan computadoras cuánticas. Volvé a correr sin${c.reset}\n` +
				`  ${c.yellow}--no-quantum-resistance en cuanto se pueda.${c.reset}`
		);
	}
	if (dryRun) {
		// La clave NO se imprime ni en dry-run: es justo la corrida que alguien le muestra a otro.
		const hostFlag = hostname ? ` --hostname ${hostname}` : "";
		const qFlags = quantum ? ` ${QUANTUM_FLAGS.join(" ")}` : "";
		console.log(`  ${c.dim}(dry-run) netbird up --setup-key <oculta> --management-url ${managementUrl}${hostFlag}${qFlags}${c.reset}`);
		return;
	}
	run(bin, args);
}

function verify(dryRun) {
	if (dryRun) return;
	const bin = which("netbird");
	const { ok, out } = run(bin, ["status"], { capture: true, allowFail: true });
	if (!ok) {
		console.log(`${c.yellow}⚠${c.reset} No se pudo leer el estado del agente. Probá \`netbird status\` a mano.`);
		return;
	}
	console.log(`\n${c.bold}Estado del agente${c.reset}\n${out.trim()}`);
	if (!/Connected|Conectado/i.test(out)) {
		console.log(
			`\n${c.yellow}⚠ El agente instaló y registró, pero todavía no figura conectado.${c.reset}\n` +
				`  Suele ser el firewall del host: hacen falta UDP 3478 (STUN) y el puerto público del plano de control.`
		);
	}
}

function main() {
	const args = parseArgs(process.argv.slice(2));
	if (args.help) return printHelp();

	if (process.platform !== "linux") fail("Este script es para Linux. En otro sistema, instalá WireGuard y el agente a mano.");
	if (typeof process.getuid === "function" && process.getuid() !== 0 && !args.dryRun) {
		fail("Hay que correrlo como root (instala paquetes y levanta una interfaz de red): usá `sudo`.");
	}
	if (!args.setupKey || !KEY_RE.test(args.setupKey)) fail("Falta `--setup-key <clave>`, o no tiene la forma de una clave de alta. Se crea en el panel de red.");
	if (!args.managementUrl || !URL_RE.test(args.managementUrl)) {
		fail("Falta `--management-url https://<host>[:<puerto>]`. Tiene que ser https y sin credenciales en la URL.");
	}
	if (args.hostname && !HOSTNAME_RE.test(args.hostname)) fail("`--hostname` admite letras, números, guiones y guiones bajos.");

	const managementUrl = args.managementUrl.replace(/\/$/, "");

	console.log(`${c.bold}${c.cyan}Alta de este host en la red privada${c.reset}`);
	console.log(`${c.dim}Plano de control: ${managementUrl}${c.reset}`);
	if (args.dryRun) console.log(`${c.yellow}Modo dry-run: no se ejecuta nada.${c.reset}`);
	console.log("");

	if (!args.skipInstall) {
		const pm = detectPackageManager();
		if (!pm) fail("No se reconoció el gestor de paquetes (apt/dnf/yum/pacman/zypper/apk). Instalá `wireguard-tools` a mano y volvé con `--skip-install`.");
		installWireguard(pm, args.dryRun);
		installAgent(args.dryRun, args.installerSha256);
	} else {
		console.log(`${c.dim}--skip-install: se salta la instalación.${c.reset}`);
	}

	joinNetwork({ setupKey: args.setupKey, managementUrl, hostname: args.hostname, quantum: args.quantum }, args.dryRun);
	verify(args.dryRun);

	console.log(`\n${c.green}${c.bold}Listo.${c.reset} Esta máquina está en la red privada.`);
	console.log(`${c.dim}Siguiente paso: darla de alta como nodo de la plataforma. En el panel de red, tab Nodos, generá el token de alta y arrancá`);
	console.log(`el kernel de esta máquina con ADC_NODE_JOIN_URL y ADC_NODE_JOIN_TOKEN — el resto de la configuración llega sola.${c.reset}`);
}

main();
