// High-level driver commands. driver.mjs is just CLI parsing + dispatch; the
// browser/CDP, viewport, auth and port plumbing live in the sibling utils.
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";
import { CHROME, SHOTS, BASE } from "./config.mjs";
import { portEntries, maxPort } from "./ports.mjs";
import { chromeArgs, launchChrome, connectCDP, waitForSelector, captureScreenshot, printPageErrors } from "./cdp.mjs";
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

// ---- ready --------------------------------------------------------------
// Wait until the gateway on :3000 actually SERVES (status < 500, redirects
// count), not just until the log marker appears — a stale instance can reach the
// marker while serving nothing. Exit 0 once it responds, 1 on timeout.
export async function ready(seconds) {
	const budgetMs = Math.max(10, Number(seconds) || 150) * 1000;
	const started = Date.now();
	console.log(`== ready == waiting for ${BASE} to serve (budget ${budgetMs / 1000}s)`);
	while (Date.now() - started < budgetMs) {
		const s = await curlStatus(3000);
		if (typeof s === "number" && s < 500) {
			console.log(`ready: gateway up (status ${s}) after ${Math.round((Date.now() - started) / 1000)}s`);
			process.exit(0);
		}
		await sleep(1000);
	}
	console.log(`ready: TIMEOUT — :3000 not serving within ${budgetMs / 1000}s`);
	process.exit(1);
}

// ---- stop ---------------------------------------------------------------
// MUST run from here, not from a shell: spawned as node children, pkill gets a
// clean argv and excludes itself (a shell `pkill -f` would match its own argv).
export async function stop() {
	for (const pat of ["bun run dev", "bun src/index.ts", "rspack-node", "rspack"]) {
		await run("pkill", ["-9", "-f", pat]);
	}
	await sleep(500);
	for (let port = 3000; port <= maxPort(); port++) {
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
const ANSI = /\x1b\[[0-9;]*m/g;
const CAP_FAIL = /CapabilityError|MISSING_SCOPE|acceso denegado|falta capability|no autorizado a|kernel key no establecida/i;

function repoRoot() {
	// utils/commands.mjs lives at <root>/.claude/skills/run-adc-platform/utils/
	return fileURLToPath(new URL("../../../../", import.meta.url));
}

export async function bootCheck(seconds) {
	const budgetMs = Math.max(30, Number(seconds) || 100) * 1000;
	const cwd = repoRoot();
	console.log(`== boot-check == cwd=${cwd} budget=${budgetMs / 1000}s`);
	const child = spawn("bun", ["src/index.ts"], {
		cwd,
		detached: true, // own process group so we can kill the whole tree (docker/rspack children)
		env: { ...process.env, NODE_ENV: "development", ENABLE_TESTS: "true" },
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
		if (CAP_FAIL.test(line)) { failures.push(line); console.log(`  ✗ CAP-FAIL  ${line.trim()}`); resolveDone(); return; }
		const m = line.match(/Servicio kernel cargado:\s*(\S+)/);
		if (m) { services.push(m[1]); console.log(`  svc  ${m[1]}`); return; }
		if (/Kernel en funcionamiento/.test(line)) {
			ready_ = true; console.log("  ✓ ready (Kernel en funcionamiento)");
			if (!drain) drain = setTimeout(resolveDone, 8000); // grace for self-test / late errors
			return;
		}
		if (/PRUEBAS COMPLETADAS/.test(line)) { selftest = true; console.log("  ✓ self-test PRUEBAS COMPLETADAS"); }
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
	console.log(`  kernel services started : ${services.length}`);
	console.log(`  ready marker            : ${ready_ ? "yes" : "NO"}`);
	console.log(`  dev self-test           : ${selftest ? "PRUEBAS COMPLETADAS" : "not seen"}`);
	console.log(`  capability/scope errors : ${failures.length}`);
	console.log(pass ? "\nboot-check: PASS" : "\nboot-check: FAIL");
	process.exit(pass ? 0 : 1);
}

// ---- drive: CDP session (navigate / interact / screenshot) --------------
export async function drive(url, name, opts) {
	const chrome = launchChrome();
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
	const chrome = launchChrome();
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
		try { cdp?.ws.close(); } catch {}
		chrome.kill("SIGKILL");
	}
}
