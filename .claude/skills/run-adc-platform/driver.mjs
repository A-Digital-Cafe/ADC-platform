#!/usr/bin/env node
// Driver for the ADC Platform federated UI.
//
// The kernel (`bun run dev`) is a gateway on :3000 that boots every app on its
// own rspack dev-server port (see docs/guides/ports.md). This driver gives an
// agent a programmatic handle on the *running* UI: health-check the ports,
// screenshot routes, and drive a page over the Chrome DevTools Protocol
// (navigate / wait-for / click / type / eval / screenshot). No npm deps — it
// shells out to `google-chrome` and talks raw CDP over the global WebSocket.
//
// Usage:
//   node driver.mjs smoke                 # curl gateway + every app port, screenshot key routes
//   node driver.mjs shot <url> [name]     # one-shot screenshot (headless --screenshot)
//   node driver.mjs drive <url> [name]    # CDP session; pass interaction flags below
//        --wait "<sel>"        wait until selector exists before acting/shooting
//        --click "<sel>"       click an element (repeatable, applied in order with --type/--eval)
//        --type "<sel>::text"  focus selector and type text (fires real key events)
//        --eval "<jsExpr>"     evaluate JS in the page, print the JSON result
//        --settle <ms>         extra wait after the last action (default 800)
//
// Screenshots land in $ADC_SHOTS (default /tmp/adc-shots). Override the browser
// with $CHROME_BIN. Gateway base is $ADC_BASE (default http://localhost:3000).

import { spawn } from "node:child_process";
import { mkdirSync, existsSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";

const CHROME = process.env.CHROME_BIN || "google-chrome";
const SHOTS = process.env.ADC_SHOTS || "/tmp/adc-shots";
const BASE = process.env.ADC_BASE || "http://localhost:3000";
const DBG_PORT = Number(process.env.ADC_CDP_PORT || 9333);

// Gateway + per-app dev ports (docs/guides/ports.md). Kept here so `smoke`
// stays a single source of truth for "is the platform up".
const PORTS = {
	"gateway (3000)": 3000,
	"test/users-management (3001)": 3001,
	"test/home (3002)": 3002,
	"test/config (3003)": 3003,
	"community-home (3010)": 3010,
	"adc-auth (3012)": 3012,
	"adc-identity (3014)": 3014,
	"my-account (3016)": 3016,
	"project-manager (3018)": 3018,
	"status (3020)": 3020,
	"help (3022)": 3022,
	"adc-home (3024)": 3024,
	"adc-error (3026)": 3026,
	"org-requests (3028)": 3028,
	"email-frontend (3030)": 3030,
	"adc-drive (3032)": 3032,
	"image-editor (3034)": 3034,
};

// Routes worth a screenshot in `smoke` — the user-facing entry pages.
const SMOKE_SHOTS = [
	["http://localhost:3024/", "home"],
	["http://localhost:3012/", "auth"],
	["http://localhost:3010/", "community-home"],
];

mkdirSync(SHOTS, { recursive: true });

function chromeArgs(extra) {
	return [
		"--headless=new",
		"--no-sandbox",
		"--disable-gpu",
		"--hide-scrollbars",
		"--disable-dev-shm-usage",
		...extra,
	];
}

// ---- one-shot screenshot (no interaction) -------------------------------
async function shot(url, name = "shot") {
	const out = `${SHOTS}/${name}.png`;
	await new Promise((resolve, reject) => {
		const p = spawn(CHROME, chromeArgs([
			"--virtual-time-budget=8000",
			"--window-size=1366,900",
			`--screenshot=${out}`,
			url,
		]), { stdio: ["ignore", "ignore", "ignore"] });
		p.on("exit", (c) => (c === 0 && existsSync(out) ? resolve() : reject(new Error(`chrome exit ${c}`))));
		p.on("error", reject);
	});
	console.log(`screenshot -> ${out}`);
	return out;
}

// ---- CDP plumbing -------------------------------------------------------
async function fetchJson(path) {
	const r = await fetch(`http://127.0.0.1:${DBG_PORT}${path}`);
	return r.json();
}

function launchChrome() {
	const p = spawn(CHROME, chromeArgs([
		`--remote-debugging-port=${DBG_PORT}`,
		"--remote-allow-origins=*",
		"--window-size=1366,900",
		"about:blank",
	]), { stdio: ["ignore", "ignore", "ignore"] });
	return p;
}

class CDP {
	constructor(ws) {
		this.ws = ws;
		this.id = 0;
		this.pending = new Map();
		this.events = [];
		ws.addEventListener("message", (e) => {
			const msg = JSON.parse(e.data);
			if (msg.id && this.pending.has(msg.id)) {
				const { resolve, reject } = this.pending.get(msg.id);
				this.pending.delete(msg.id);
				msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result);
			} else if (msg.method) {
				this.events.push(msg);
			}
		});
	}
	send(method, params = {}) {
		const id = ++this.id;
		this.ws.send(JSON.stringify({ id, method, params }));
		return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
	}
	async eval(expr) {
		const r = await this.send("Runtime.evaluate", {
			expression: expr,
			returnByValue: true,
			awaitPromise: true,
		});
		if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + " :: " + (r.exceptionDetails.exception?.description || ""));
		return r.result?.value;
	}
}

async function connectCDP() {
	// poll until the debugging endpoint is up
	let target;
	for (let i = 0; i < 50; i++) {
		try {
			const list = await fetchJson("/json/list");
			target = list.find((t) => t.type === "page");
			if (target?.webSocketDebuggerUrl) break;
		} catch {}
		await sleep(200);
	}
	if (!target) throw new Error("no CDP page target");
	const ws = new WebSocket(target.webSocketDebuggerUrl);
	await new Promise((res, rej) => {
		ws.addEventListener("open", res, { once: true });
		ws.addEventListener("error", rej, { once: true });
	});
	const cdp = new CDP(ws);
	await cdp.send("Page.enable");
	await cdp.send("Runtime.enable");
	return cdp;
}

async function waitForSelector(cdp, sel, timeoutMs = 15000) {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		const found = await cdp.eval(`!!document.querySelector(${JSON.stringify(sel)})`);
		if (found) return true;
		await sleep(250);
	}
	throw new Error(`timeout waiting for selector ${sel}`);
}

async function drive(url, name, opts) {
	const chrome = launchChrome();
	let cdp;
	try {
		cdp = await connectCDP();
		await cdp.send("Page.navigate", { url });
		// give the SPA a beat; rspack first-compile routes are slow on first hit
		await sleep(1500);
		if (opts.wait) await waitForSelector(cdp, opts.wait);

		for (const action of opts.actions) {
			if (action.kind === "click") {
				const ok = await cdp.eval(`(()=>{const el=document.querySelector(${JSON.stringify(action.sel)}); if(!el) return false; el.click(); return true;})()`);
				if (!ok) throw new Error(`click: selector not found: ${action.sel}`);
			} else if (action.kind === "type") {
				await cdp.eval(`(()=>{const el=document.querySelector(${JSON.stringify(action.sel)}); if(!el) throw new Error('type: not found'); el.focus();})()`);
				await cdp.send("Input.insertText", { text: action.text });
			} else if (action.kind === "eval") {
				const v = await cdp.eval(action.expr);
				console.log("eval ->", JSON.stringify(v));
			}
			await sleep(400);
		}

		await sleep(opts.settle);
		const { data } = await cdp.send("Page.captureScreenshot", { format: "png" });
		const out = `${SHOTS}/${name}.png`;
		await Bun_or_node_writeFile(out, Buffer.from(data, "base64"));
		console.log(`screenshot -> ${out}`);

		// surface page errors so a green screenshot of a broken page is caught
		const errs = cdp.events.filter((e) => e.method === "Runtime.exceptionThrown");
		if (errs.length) console.log(`page exceptions: ${errs.length} (rerun with --eval "window.__x" to inspect)`);
		const title = await cdp.eval("document.title");
		console.log(`title -> ${JSON.stringify(title)}`);
	} finally {
		try { cdp?.ws.close(); } catch {}
		chrome.kill("SIGKILL");
	}
}

async function Bun_or_node_writeFile(path, buf) {
	const { writeFile } = await import("node:fs/promises");
	await writeFile(path, buf);
}

// ---- smoke --------------------------------------------------------------
async function curlStatus(port) {
	try {
		const r = await fetch(`http://localhost:${port}/`, { redirect: "manual" });
		return r.status;
	} catch (e) {
		return `ERR ${e.code || e.message}`;
	}
}

async function smoke() {
	console.log("== port health ==");
	let bad = 0;
	for (const [label, port] of Object.entries(PORTS)) {
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

// ---- stop ---------------------------------------------------------------
// MUST run from here, not from a shell. The repo's `bun run cleanup` (and any
// `pkill -f rspack` you type) self-destructs the agent: pkill -f matches the
// calling shell because the pattern text is sitting in that shell's own argv.
// Spawned as node children, pkill gets a clean argv and excludes itself.
function run(cmd, args) {
	return new Promise((resolve) => {
		const p = spawn(cmd, args, { stdio: ["ignore", "ignore", "ignore"] });
		p.on("exit", () => resolve());
		p.on("error", () => resolve());
	});
}

async function stop() {
	for (const pat of ["bun run dev", "bun src/index.ts", "rspack-node", "rspack"]) {
		await run("pkill", ["-9", "-f", pat]);
	}
	await sleep(500);
	for (let port = 3000; port <= 3034; port++) {
		await run("fuser", ["-k", "-9", `${port}/tcp`]);
	}
	await sleep(800);
	const left = [];
	for (const [label, port] of Object.entries(PORTS)) {
		const s = await curlStatus(port);
		if (typeof s === "number") left.push(label);
	}
	if (left.length) console.log(`stop: still up -> ${left.join(", ")}`);
	else console.log("stop: all dev ports free (S3 on :9000/:9001 left intact)");
}

// ---- arg parsing --------------------------------------------------------
function parseDrive(argv) {
	const opts = { wait: null, actions: [], settle: 800 };
	const rest = [];
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i];
		if (a === "--wait") opts.wait = argv[++i];
		else if (a === "--settle") opts.settle = Number(argv[++i]);
		else if (a === "--click") opts.actions.push({ kind: "click", sel: argv[++i] });
		else if (a === "--eval") opts.actions.push({ kind: "eval", expr: argv[++i] });
		else if (a === "--type") {
			const [sel, ...t] = argv[++i].split("::");
			opts.actions.push({ kind: "type", sel, text: t.join("::") });
		} else rest.push(a);
	}
	return { opts, rest };
}

const [cmd, ...args] = process.argv.slice(2);
try {
	if (cmd === "smoke") await smoke();
	else if (cmd === "stop") await stop();
	else if (cmd === "shot") await shot(args[0] || BASE, args[1] || "shot");
	else if (cmd === "drive") {
		const { opts, rest } = parseDrive(args);
		await drive(rest[0] || BASE, rest[1] || "drive", opts);
	} else {
		console.log("usage: node driver.mjs <smoke | shot <url> [name] | drive <url> [name] [--wait sel --click sel --type 'sel::text' --eval expr --settle ms]>");
		process.exit(2);
	}
} catch (e) {
	console.error("driver error:", e.message);
	process.exit(1);
}
