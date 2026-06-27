// Chrome + Chrome DevTools Protocol plumbing: launch headless chrome, open a CDP
// session, wait for selectors, capture screenshots, and surface page errors.
import { spawn } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { setTimeout as sleep } from "node:timers/promises";
import { CHROME, DBG_PORT } from "./config.mjs";

export function chromeArgs(extra) {
	return ["--headless=new", "--no-sandbox", "--disable-gpu", "--hide-scrollbars", "--disable-dev-shm-usage", ...extra];
}

export function launchChrome() {
	return spawn(CHROME, chromeArgs([`--remote-debugging-port=${DBG_PORT}`, "--remote-allow-origins=*", "--window-size=1366,900", "about:blank"]), {
		stdio: ["ignore", "ignore", "ignore"],
	});
}

async function fetchJson(path) {
	const r = await fetch(`http://127.0.0.1:${DBG_PORT}${path}`);
	return r.json();
}

export class CDP {
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
		const r = await this.send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true });
		if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + " :: " + (r.exceptionDetails.exception?.description || ""));
		return r.result?.value;
	}
}

export async function connectCDP() {
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

export async function waitForSelector(cdp, sel, timeoutMs = 15000) {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		if (await cdp.eval(`!!document.querySelector(${JSON.stringify(sel)})`)) return true;
		await sleep(250);
	}
	throw new Error(`timeout waiting for selector ${sel}`);
}

// Screenshot the current page to a PNG file.
export async function captureScreenshot(cdp, outPath) {
	const { data } = await cdp.send("Page.captureScreenshot", { format: "png" });
	await writeFile(outPath, Buffer.from(data, "base64"));
	console.log(`screenshot -> ${outPath}`);
}

// Print the real text of page exceptions + console.error/warn captured this
// session, so a green screenshot of a broken page is caught (not just a count).
export function printPageErrors(cdp) {
	const exceptions = cdp.events.filter((e) => e.method === "Runtime.exceptionThrown");
	for (const ex of exceptions.slice(0, 20)) {
		const d = ex.params?.exceptionDetails;
		console.log(`  ✗ exception: ${(d?.exception?.description || d?.text || "(unknown exception)").split("\n")[0]}`);
	}
	const consoleErrs = cdp.events.filter((e) => e.method === "Runtime.consoleAPICalled" && (e.params.type === "error" || e.params.type === "warning"));
	for (const c of consoleErrs.slice(0, 20)) {
		const text = (c.params.args || []).map((a) => a.value ?? a.description ?? a.unserializableValue ?? "").join(" ").trim();
		if (text) console.log(`  • console.${c.params.type}: ${text.split("\n")[0]}`);
	}
	if (!exceptions.length && !consoleErrs.length) console.log("page errors: none");
	else if (exceptions.length > 20 || consoleErrs.length > 20) console.log("  … (truncated)");
}
