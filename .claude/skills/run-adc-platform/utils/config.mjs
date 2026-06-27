// Shared configuration + dev credentials for the driver.
// Env overrides: $CHROME_BIN (browser), $ADC_SHOTS (screenshot dir),
// $ADC_BASE (gateway), $ADC_CDP_PORT (Chrome remote-debugging port).
import { mkdirSync } from "node:fs";

export const CHROME = process.env.CHROME_BIN || "google-chrome";
export const SHOTS = process.env.ADC_SHOTS || "/tmp/adc-shots";
export const BASE = process.env.ADC_BASE || "http://localhost:3000";
export const DBG_PORT = Number(process.env.ADC_CDP_PORT || 9333);

// Dev test users seeded by IdentityManagerService in NODE_ENV=development
// (src/services/core/IdentityManagerService/defaults/devUsers.ts — keep in sync).
// `orgId` is the dev org's stable id so the org admin lands straight in its context.
export const DEV_USERS = {
	admin: { username: "devadmin", password: "devadmin123" },
	orgadmin: { username: "devorgadmin", password: "devorgadmin123", orgId: "dev-org" },
};

mkdirSync(SHOTS, { recursive: true });
