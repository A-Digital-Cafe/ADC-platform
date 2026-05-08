import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parse } from "dotenv";

const protectedKeys = new Set(Object.keys(process.env));

function loadEnvFile(fileName: string): void {
	const filePath = resolve(process.cwd(), fileName);
	if (!existsSync(filePath)) return;

	const values = parse(readFileSync(filePath));
	for (const [key, value] of Object.entries(values)) {
		if (protectedKeys.has(key)) continue;
		process.env[key] = value;
	}
}

loadEnvFile(".env");
loadEnvFile(".env.local");

if (process.env.NODE_ENV) {
	loadEnvFile(`.env.${process.env.NODE_ENV}`);
	loadEnvFile(`.env.${process.env.NODE_ENV}.local`);
}
