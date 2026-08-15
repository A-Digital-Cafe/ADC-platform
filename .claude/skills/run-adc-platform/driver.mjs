#!/usr/bin/env node
// Entry point for the ADC Platform driver — CLI parsing + dispatch only.
//
// The kernel (`bun run dev`) is a gateway on :3000 that boots every app on its
// own rspack dev-server port (docs/guides/ports.csv — the single source of truth
// this driver and `bun run cleanup` both read). Responsibilities are split under
// ./utils: config (env + dev users), ports (CSV reader), cdp (chrome/DevTools),
// viewport (mobile emulation), auth (dev login), commands (the verbs below).
//
// Usage:
//   node driver.mjs boot-check [seconds]   # boot kernel directly (no UI servers); PASS/FAIL
//   node driver.mjs up [seconds]           # launch `bun run dev` detached, wait until :3000 serves
//   node driver.mjs ready [app|port] [s]   # block until the gateway (or one app) actually serves
//   node driver.mjs port <app>             # resolve an app name to its dev port
//   node driver.mjs logs <app> [n]         # tail that app's bundler log (temp/logs/)
//   node driver.mjs smoke                  # curl every app port + screenshot key routes
//   node driver.mjs shot <url> [name]      # one-shot screenshot
//   node driver.mjs login <who> [url] [name]
//   node driver.mjs drive <url> [name]     # CDP session (flags below)
//   node driver.mjs status                 # what's up + who is using the environment
//   node driver.mjs stop [--force]         # kill kernel + rspack servers, free ports
//
// Flags (drive; --mobile/--device/--viewport also work on shot/login):
//   --login <who>  --wait "<sel>"  --wait-timeout <ms>  --click "<sel>"
//   --type "<sel>::text"  --eval "<jsExpr>"  --settle <ms>
//   --mobile | --device <pixel7|iphone|mobile> | --viewport <WxH>
//
// Screenshots land in $ADC_SHOTS (default /tmp/adc-shots). See SKILL.md for the
// full guide, gotchas and troubleshooting.
//
// PARALELISMO: todo comando que toca el entorno se serializa con un lock de
// archivo y espera su turno en vez de atropellar a otra sesión. `--lock-timeout
// <s>` acota la espera y `status` dice quién lo tiene; exportá
// ADC_DRIVER_SESSION=<id> para que además `stop` respete a las otras sesiones.
import { BASE } from "./utils/config.mjs";
import { resolveViewport } from "./utils/viewport.mjs";
import { bootCheck, ready, smoke, shot, login, drive, stop, port, logs, up, status } from "./utils/commands.mjs";
import { withLock } from "./utils/lock.mjs";

function parseDrive(argv) {
	const opts = { wait: null, waitTimeout: 15000, actions: [], settle: 800, login: null, mobile: false, device: null, viewport: null };
	const rest = [];
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i];
		if (a === "--wait") opts.wait = argv[++i];
		else if (a === "--wait-timeout") opts.waitTimeout = Number(argv[++i]);
		else if (a === "--settle") opts.settle = Number(argv[++i]);
		else if (a === "--login") opts.login = argv[++i];
		else if (a === "--mobile") opts.mobile = true;
		else if (a === "--device") opts.device = argv[++i];
		else if (a === "--viewport") opts.viewport = argv[++i];
		else if (a === "--click") opts.actions.push({ kind: "click", sel: argv[++i] });
		else if (a === "--eval") opts.actions.push({ kind: "eval", expr: argv[++i] });
		else if (a === "--type") {
			const [sel, ...t] = argv[++i].split("::");
			opts.actions.push({ kind: "type", sel, text: t.join("::") });
		} else rest.push(a);
	}
	return { opts, rest };
}

const [cmd, ...argv] = process.argv.slice(2);

// `--force` y `--lock-timeout` son del driver, no de los comandos: se sacan antes.
const force = argv.includes("--force");
const timeoutAt = argv.indexOf("--lock-timeout");
const lockWaitMs = timeoutAt === -1 ? undefined : Number(argv[timeoutAt + 1]) * 1000;
// `timeoutAt + 1` es el valor del flag; sin flag, `timeoutAt` es -1 y ese índice
// sería el 0, que se comería el primer argumento real (la URL de `drive`).
const valueAt = timeoutAt === -1 ? -1 : timeoutAt + 1;
const args = argv.filter((a, i) => a !== "--force" && a !== "--lock-timeout" && i !== valueAt);

// `port`, `logs` y `status` sólo leen: no tocan procesos ni el navegador, así que
// no se encolan (y `status` tiene que poder responder JUSTO cuando otro tiene el lock).
const READ_ONLY = new Set(["port", "logs", "status", undefined]);
const serialize = (fn) => (READ_ONLY.has(cmd) ? fn() : withLock(cmd, fn, { waitMs: lockWaitMs }));

try {
	await serialize(async () => {
	if (cmd === "smoke") await smoke();
	else if (cmd === "status") await status();
	else if (cmd === "boot-check") await bootCheck(args.find((a) => a !== "--with-ui"), { withUi: args.includes("--with-ui") });
	else if (cmd === "up") await up(args[0]);
	else if (cmd === "ready") await ready(args[0], args[1]);
	else if (cmd === "port") await port(args[0]);
	else if (cmd === "logs") await logs(args[0], args[1]);
	else if (cmd === "stop") await stop({ force });
	else if (cmd === "shot") {
		const { opts, rest } = parseDrive(args);
		await shot(rest[0] || BASE, rest[1] || "shot", resolveViewport(opts));
	} else if (cmd === "login") {
		const { opts, rest } = parseDrive(args);
		await login(rest[0], rest[1] || BASE, rest[2] || "login", opts);
	} else if (cmd === "drive") {
		const { opts, rest } = parseDrive(args);
		await drive(rest[0] || BASE, rest[1] || "drive", opts);
	} else {
		console.log(
			"usage: node driver.mjs <status | boot-check [s] [--with-ui] | up [s] | ready [app|port] [s] | port <app> | logs <app> [n] | smoke | shot <url> [name] | login <who> [url] [name] | drive <url> [name] [flags] | stop [--force]>"
		);
		console.log("  flags: --login <who> --wait <sel> --wait-timeout <ms> --click <sel> --type <sel::text> --eval <expr> --settle <ms> --mobile --device <d> --viewport <WxH>");
		console.log("  globales: --lock-timeout <s> (cuánto esperar el turno) · --force (stop: ignorar la actividad de otra sesión)");
		process.exit(2);
	}
	});
} catch (e) {
	console.error("driver error:", e.message);
	process.exit(1);
}
