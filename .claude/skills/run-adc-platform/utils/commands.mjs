// High-level driver commands. driver.mjs is just CLI parsing + dispatch; the
// browser/CDP, viewport, auth and port plumbing live in the sibling utils.
import { spawn } from "node:child_process";
import { existsSync, readdirSync, readFileSync, mkdirSync, openSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";
import { CHROME, DBG_PORT, SHOTS } from "./config.mjs";
import { portEntries, loadPorts } from "./ports.mjs";
import { captureScreenshot, chromeArgs, connectCDP, launchChromeChecked, printPageErrors, waitForSelector } from "./cdp.mjs";
import { resolveViewport, applyViewport } from "./viewport.mjs";
import { loginSession } from "./auth.mjs";

// Routes worth a screenshot in `smoke` — the user-facing entry pages.
const SMOKE_SHOTS = [
	["http://localhost:3024/", "home"],
	["http://localhost:3012/", "auth"],
	["http://localhost:3010/", "community-home"],
];

async function curlStatus(port) {
	try {
		const r = await fetch(`http://localhost:${port}/`, { redirect: "manual" });
		return r.status;
	} catch (e) {
		return `ERR ${e.code || e.message}`;
	}
}

// Spawn a child for pkill/fuser with clean argv (so `pkill -f` never matches the
// agent's own shell — see SKILL.md gotcha).
function run(cmd, args) {
	return new Promise((resolve) => {
		const p = spawn(cmd, args, { stdio: ["ignore", "ignore", "ignore"] });
		p.on("exit", () => resolve());
		p.on("error", () => resolve());
	});
}

// ---- shot: one-shot headless screenshot (no interaction) ----------------
// `vp` (from --mobile/--device/--viewport) sizes the window + device-scale so
// the screenshot reflects responsive layout. For real touch/UA emulation use
// `drive --mobile` (one-shot headless can't drive CDP Emulation).
export async function shot(url, name = "shot", vp = null) {
	const out = `${SHOTS}/${name}.png`;
	const extra = ["--virtual-time-budget=8000", `--window-size=${vp ? `${vp.width},${vp.height}` : "1366,900"}`];
	if (vp?.dsf) extra.push(`--force-device-scale-factor=${vp.dsf}`);
	if (vp?.ua) extra.push(`--user-agent=${vp.ua}`);
	extra.push(`--screenshot=${out}`, url);
	await new Promise((resolve, reject) => {
		const p = spawn(CHROME, chromeArgs(extra), { stdio: ["ignore", "ignore", "ignore"] });
		p.on("exit", (c) => (c === 0 && existsSync(out) ? resolve() : reject(new Error(`chrome exit ${c}`))));
		p.on("error", reject);
	});
	console.log(`screenshot -> ${out}`);
	return out;
}

// ---- smoke --------------------------------------------------------------
export async function smoke() {
	console.log("== port health ==");
	let bad = 0;
	for (const [label, port] of portEntries()) {
		const s = await curlStatus(port);
		const ok = typeof s === "number" && s < 500;
		if (!ok) bad++;
		console.log(`  ${ok ? "OK " : "XX "} ${String(s).padEnd(8)} ${label}`);
	}
	console.log("== screenshots ==");
	for (const [url, name] of SMOKE_SHOTS) {
		try { await shot(url, name); } catch (e) { bad++; console.log(`  FAIL ${name}: ${e.message}`); }
	}
	console.log(bad ? `\nsmoke: ${bad} problem(s)` : "\nsmoke: all good");
	process.exit(bad ? 1 : 0);
}

// ---- port: resolve an app name to its dev port --------------------------
// Substring match against ports.csv, so `port drive` -> 3032. Exact port numbers
// pass straight through, which makes `port` safe to use inside other commands.
export function resolvePort(target) {
	const rows = loadPorts();
	const asNum = Number(target);
	if (Number.isInteger(asNum) && rows.some((r) => r.port === asNum)) return { port: asNum, app: rows.find((r) => r.port === asNum).app };
	const needle = String(target || "").toLowerCase();
	const hits = rows.filter((r) => r.app.toLowerCase().includes(needle));
	if (hits.length === 0) throw new Error(`no app in ports.csv matches "${target}" (try: ${rows.map((r) => r.app).join(", ")})`);
	// Prefer an exact tail match so `adc-image-editor` does not resolve to `-mobile`.
	const exact = hits.find((r) => r.app.toLowerCase().endsWith(`/${needle}`) || r.app.toLowerCase() === needle);
	const chosen = exact || hits[0];
	if (!exact && hits.length > 1) console.log(`  (ambiguous "${target}": ${hits.map((h) => h.app).join(", ")} -> picking ${chosen.app})`);
	return { port: chosen.port, app: chosen.app };
}

export async function port(target) {
	if (!target) { console.log("usage: driver.mjs port <app-substring|port>"); process.exit(2); }
	const { port: p, app } = resolvePort(target);
	console.log(`${p}	${app}`);
}

// ---- ready --------------------------------------------------------------
// Wait until a target actually SERVES (status < 500), not just until the log marker
// appears — a stale instance can reach the marker while serving nothing.
// `arg` is a port/app from ports.csv (the TARGET) or, failing that, a budget in seconds.
export async function ready(arg, seconds) {
	let target = 3000;
	let label = "gateway";
	let budgetArg = arg;
	if (arg !== undefined && arg !== null && String(arg).length > 0) {
		let resolved = null;
		try { resolved = resolvePort(arg); } catch { resolved = null; }
		if (resolved) {
			target = resolved.port;
			label = resolved.app;
			budgetArg = seconds;
		} else if (!Number.isFinite(Number(arg))) {
			console.log(`ready: "${arg}" is neither a budget nor an app/port in ports.csv`);
			process.exit(2);
		}
	}
	const budgetMs = Math.max(10, Number(budgetArg) || 150) * 1000;
	const started = Date.now();
	console.log(`== ready == waiting for ${label} on :${target} to serve (budget ${budgetMs / 1000}s)`);
	while (Date.now() - started < budgetMs) {
		const s = await curlStatus(target);
		if (typeof s === "number" && s < 500) {
			console.log(`ready: ${label} up (status ${s}) after ${Math.round((Date.now() - started) / 1000)}s`);
			process.exit(0);
		}
		await sleep(1000);
	}
	console.log(`ready: TIMEOUT — ${label} on :${target} not serving within ${budgetMs / 1000}s`);
	process.exit(1);
}

// ---- logs: tail an app's BUNDLER log ------------------------------------
// `temp/logs/app/<namespace>-<name>.log` (rspack-process.ts) is the ONLY place a bundle
// error exists; temp/logs/kernel-dev.log carries the kernel line, not the stack. Both
// live under temp/logs, so the whole tree is collected.
function collectLogs(dir, prefix = "") {
	let entries;
	try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return null; }
	const out = [];
	for (const e of entries) {
		if (e.isDirectory()) out.push(...(collectLogs(path.join(dir, e.name), `${prefix}${e.name}/`) ?? []));
		else if (e.name.endsWith(".log")) out.push(`${prefix}${e.name}`);
	}
	return out;
}

export async function logs(target, lines) {
	if (!target) { console.log("usage: driver.mjs logs <app-substring> [lines]"); process.exit(2); }
	const n = Math.max(1, Number(lines) || 40);
	const dir = path.join(repoRoot(), "temp", "logs");
	const files = collectLogs(dir);
	if (files === null) {
		console.log(`logs: ${dir} does not exist yet — has the platform been booted?`);
		process.exit(1);
	}
	// Log names are `<namespace>-<uiModule.name>`, which is not the ports.csv label, so match the
    // bare app name against the filename.
	const needle = String(target).toLowerCase().replace(/^.*\//, "");
	const hits = files.filter((f) => f.toLowerCase().includes(needle));
	if (hits.length === 0) {
		console.log(`logs: no log matches "${target}" in temp/logs (have: ${files.join(", ") || "none"})`);
		process.exit(1);
	}
	for (const file of hits) {
		const full = path.join(dir, file);
		const content = readFileSync(full, "utf8").split(/\r?\n/);
		console.log(`\n== temp/logs/${file} (last ${n} of ${content.length} lines) ==`);
		console.log(content.slice(-n).join("\n"));
	}
}

// ---- up: launch the platform in the background --------------------------
// Single documented entry point, so the log lands where `logs` can find it.
export async function up(seconds) {
	const cwd = repoRoot();
	const dir = path.join(cwd, "temp", "logs");
	mkdirSync(dir, { recursive: true });
	const logFile = path.join(dir, "kernel-dev.log");
	const out = openSync(logFile, "a");
	const child = spawn("bun", ["run", "dev"], { cwd, detached: true, stdio: ["ignore", out, out] });
	child.unref();
	console.log(`== up == pid ${child.pid}, log: temp/logs/kernel-dev.log`);
	await ready(undefined, seconds);
}

// ---- stop ---------------------------------------------------------------
// MUST run from here, not from a shell: spawned as node children, pkill gets a
// clean argv and excludes itself (a shell `pkill -f` would match its own argv).
export async function stop() {
	// Must cover the Stencil side (watchers, worker threads, MF broker/dev-worker) and the headless
	// Chrome too: survivors keep recompiling, and a leaked Chrome holding DBG_PORT makes the next
	// run attach to it and screenshot stale code.
	const patterns = [
		"bun run dev",
		"bun src/index.ts",
		"rspack-node",
		"rspack",
		"stencil build --watch",
		"@stencil/core/sys/node/worker.js",
		"fork-dev-worker.js",
		"start-broker.js",
		`remote-debugging-port=${DBG_PORT}`,
	];
	for (const pat of patterns) {
		await run("pkill", ["-9", "-f", pat]);
	}
	await sleep(500);
	// Only the ports declared in ports.csv: a range sweep would kill unrelated services.
	for (const port of portEntries().map(([, p]) => p)) {
		await run("fuser", ["-k", "-9", `${port}/tcp`]);
	}
	await sleep(800);
	const left = [];
	for (const [label, port] of portEntries()) {
		if (typeof (await curlStatus(port)) === "number") left.push(label);
	}
	if (left.length) console.log(`stop: still up -> ${left.join(", ")}`);
	else console.log("stop: all dev ports free (S3 on :9000/:9001 left intact)");
}

// ---- boot-check ---------------------------------------------------------
// Boot the kernel DIRECTLY (`bun src/index.ts`, not `bun run dev`) and stream a
// filtered view of startup: kernel-mode service starts, the ready marker, the
// dev self-test, and ANY capability/scope failure. One foreground call — no temp
// logs, no detached background (both get reaped in sandboxed shells). Frees the
// ports on exit. PASS = ready marker reached with zero capability/scope failures.
//
// Runs with ADC_NO_UI_SERVERS=true: UI modules register but nothing is compiled and no
// bundler child is spawned, so a healthy kernel does not FAIL on the ~27 children and
// their waits. Pass `--with-ui` for a full boot.
const ANSI = /\x1b\[[0-9;]*m/g;
const CAP_FAIL = /CapabilityError|MISSING_SCOPE|acceso denegado|falta capability|no autorizado a|kernel key no establecida/i;

function repoRoot() {
	// utils/commands.mjs lives at <root>/.claude/skills/run-adc-platform/utils/
	return fileURLToPath(new URL("../../../../", import.meta.url));
}

export async function bootCheck(seconds, opts = {}) {
	const withUi = !!opts.withUi;
	// Kernel-only boots have nothing to compile, so they get a shorter default budget.
	const budgetMs = Math.max(30, Number(seconds) || (withUi ? 180 : 90)) * 1000;
	const cwd = repoRoot();
	const t0 = Date.now();
	const el = () => `${((Date.now() - t0) / 1000).toFixed(1)}s`;
	console.log(`== boot-check == cwd=${cwd} budget=${budgetMs / 1000}s ui=${withUi ? "on" : "off (kernel-only)"}`);
	const child = spawn("bun", ["src/index.ts"], {
		cwd,
		detached: true, // own process group so we can kill the whole tree (docker/rspack children)
		env: {
			...process.env,
			NODE_ENV: "development",
			ENABLE_TESTS: "true",
			...(withUi ? {} : { ADC_NO_UI_SERVERS: "true" }),
		},
		stdio: ["ignore", "pipe", "pipe"],
	});

	const services = [];
	const failures = [];
	let ready_ = false;
	let selftest = false;
	let buf = "";
	let resolveDone;
	const done = new Promise((r) => (resolveDone = r));
	let drain = null;

	const handleLine = (raw) => {
		const line = raw.replace(ANSI, "").trimEnd();
		// Accumulate failures instead of bailing on the first: N capability errors in one boot.
		if (CAP_FAIL.test(line)) { failures.push(line); console.log(`  ✗ CAP-FAIL  [${el()}] ${line.trim()}`); return; }
		const m = line.match(/Servicio kernel cargado:\s*(\S+)/);
		if (m) { services.push(m[1]); console.log(`  svc  [${el()}] ${m[1]}`); return; }
		if (/Kernel en funcionamiento/.test(line)) {
			ready_ = true; console.log(`  ✓ ready [${el()}] (Kernel en funcionamiento)`);
			if (!drain) drain = setTimeout(resolveDone, 8000); // grace for self-test / late errors
			return;
		}
		if (/PRUEBAS COMPLETADAS/.test(line)) { selftest = true; console.log(`  ✓ self-test [${el()}] PRUEBAS COMPLETADAS`); }
	};
	const onChunk = (c) => {
		buf += c.toString();
		let nl;
		while ((nl = buf.indexOf("\n")) >= 0) { handleLine(buf.slice(0, nl)); buf = buf.slice(nl + 1); }
	};
	child.stdout.on("data", onChunk);
	child.stderr.on("data", onChunk);
	child.on("exit", () => resolveDone());
	const budget = setTimeout(resolveDone, budgetMs);

	await done;
	clearTimeout(budget);
	if (drain) clearTimeout(drain);
	try { process.kill(-child.pid, "SIGKILL"); } catch {}
	await stop();

	const pass = ready_ && failures.length === 0;
	console.log("\n== boot-check summary ==");
	console.log(`  total elapsed           : ${el()}`);
	console.log(`  kernel services started : ${services.length}`);
	console.log(`  ready marker            : ${ready_ ? "yes" : "NO"}`);
	console.log(`  dev self-test           : ${selftest ? "PRUEBAS COMPLETADAS" : "not seen"}`);
	console.log(`  capability/scope errors : ${failures.length}`);
	console.log(pass ? "\nboot-check: PASS" : "\nboot-check: FAIL");
	process.exit(pass ? 0 : 1);
}

// ---- drive: CDP session (navigate / interact / screenshot) --------------
export async function drive(url, name, opts) {
	const chrome = await launchChromeChecked();
	let cdp;
	try {
		cdp = await connectCDP();
		await applyViewport(cdp, resolveViewport(opts));
		if (opts.login) await loginSession(cdp, opts.login);
		await cdp.send("Page.navigate", { url });
		await sleep(1500); // rspack first-compile routes are slow on first hit
		if (opts.wait) await waitForSelector(cdp, opts.wait, opts.waitTimeout);

		for (const action of opts.actions) {
			if (action.kind === "click") {
				const ok = await cdp.eval(`(()=>{const el=document.querySelector(${JSON.stringify(action.sel)}); if(!el) return false; el.click(); return true;})()`);
				if (!ok) throw new Error(`click: selector not found: ${action.sel}`);
			} else if (action.kind === "type") {
				await cdp.eval(`(()=>{const el=document.querySelector(${JSON.stringify(action.sel)}); if(!el) throw new Error('type: not found'); el.focus();})()`);
				await cdp.send("Input.insertText", { text: action.text });
			} else if (action.kind === "eval") {
				console.log("eval ->", JSON.stringify(await cdp.eval(action.expr)));
			}
			await sleep(400);
		}

		await sleep(opts.settle);
		await captureScreenshot(cdp, `${SHOTS}/${name}.png`);
		printPageErrors(cdp);
		console.log(`title -> ${JSON.stringify(await cdp.eval("document.title"))}`);
	} finally {
		try { cdp?.ws.close(); } catch {}
		chrome.kill("SIGKILL");
	}
}

// ---- login: authenticate then screenshot a route as that user ----------
export async function login(who, url, name, opts = {}) {
	const chrome = await launchChromeChecked();
	let cdp;
	try {
		cdp = await connectCDP();
		await applyViewport(cdp, resolveViewport(opts));
		await loginSession(cdp, who);
		await cdp.send("Page.navigate", { url });
		await sleep(1500);
		await captureScreenshot(cdp, `${SHOTS}/${name}.png`);
		printPageErrors(cdp);
		console.log(`title -> ${JSON.stringify(await cdp.eval("document.title"))}`);
	} finally {
		try { cdp?.ws.close(); } catch {
			// NO-OP
		}
		chrome.kill("SIGKILL");
	}
}
