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
//   node driver.mjs boot-check [seconds]   # boot kernel directly; PASS/FAIL on clean start
//   node driver.mjs ready [seconds]        # block until :3000 actually serves
//   node driver.mjs smoke                  # curl every app port + screenshot key routes
//   node driver.mjs shot <url> [name]      # one-shot screenshot
//   node driver.mjs login <who> [url] [name]
//   node driver.mjs drive <url> [name]     # CDP session (flags below)
//   node driver.mjs stop                   # kill kernel + rspack servers, free ports
//
// Flags (drive; --mobile/--device/--viewport also work on shot/login):
//   --login <who>  --wait "<sel>"  --wait-timeout <ms>  --click "<sel>"
//   --type "<sel>::text"  --eval "<jsExpr>"  --settle <ms>
//   --mobile | --device <pixel7|iphone|mobile> | --viewport <WxH>
//
// Screenshots land in $ADC_SHOTS (default /tmp/adc-shots). See SKILL.md for the
// full guide, gotchas and troubleshooting.
import { BASE } from "./utils/config.mjs";
import { resolveViewport } from "./utils/viewport.mjs";
import { bootCheck, ready, smoke, shot, login, drive, stop } from "./utils/commands.mjs";

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

const [cmd, ...args] = process.argv.slice(2);
try {
	if (cmd === "smoke") await smoke();
	else if (cmd === "boot-check") await bootCheck(args[0]);
	else if (cmd === "ready") await ready(args[0]);
	else if (cmd === "stop") await stop();
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
		console.log("usage: node driver.mjs <boot-check [s] | ready [s] | smoke | shot <url> [name] | login <who> [url] [name] | drive <url> [name] [flags]>");
		console.log("  flags: --login <who> --wait <sel> --wait-timeout <ms> --click <sel> --type <sel::text> --eval <expr> --settle <ms> --mobile --device <d> --viewport <WxH>");
		process.exit(2);
	}
} catch (e) {
	console.error("driver error:", e.message);
	process.exit(1);
}
