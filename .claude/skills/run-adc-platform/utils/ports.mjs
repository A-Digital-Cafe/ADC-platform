// Dev port registry. Single source of truth: docs/guides/ports.csv
// (columns: port,app,notes). Both this driver and `bun run cleanup` read it, so
// a newly-registered app port is picked up everywhere without editing code.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const CSV = fileURLToPath(new URL("../../../../docs/guides/ports.csv", import.meta.url));

// Minimal CSV split into [port, app, notes], keeping any commas inside notes.
function parseRow(line) {
	const i1 = line.indexOf(",");
	if (i1 < 0) return null;
	const i2 = line.indexOf(",", i1 + 1);
	const port = line.slice(0, i1).trim();
	const app = (i2 < 0 ? line.slice(i1 + 1) : line.slice(i1 + 1, i2)).trim();
	const notes = i2 < 0 ? "" : line.slice(i2 + 1).trim();
	return { port, app, notes };
}

export function loadPorts() {
	const rows = [];
	const text = readFileSync(CSV, "utf8");
	for (const line of text.split(/\r?\n/)) {
		if (!line.trim() || /^port\s*,/i.test(line)) continue; // skip blanks + header
		const r = parseRow(line);
		const n = Number(r?.port);
		if (Number.isInteger(n)) rows.push({ port: n, app: r.app || `:${n}`, notes: r.notes });
	}
	return rows;
}

// [label, port] pairs for health-check output ("public/adc-drive (3032)").
export function portEntries() {
	return loadPorts().map((p) => [`${p.app} (${p.port})`, p.port]);
}

export function maxPort() {
	return loadPorts().reduce((m, p) => Math.max(m, p.port), 3000);
}
