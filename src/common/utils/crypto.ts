import * as crypto from "node:crypto";

export function generateId(): string {
	return crypto.randomUUID();
}

export function hashPassword(password: string): string {
	const salt = crypto.randomBytes(16).toString("hex");
	const hash = crypto.pbkdf2Sync(password, salt, 100000, 64, "sha512").toString("hex");
	return `${salt}:${hash}`;
}

export function verifyPassword(password: string, passwordHash: string): boolean {
	const [salt, hash] = passwordHash.split(":");
	if (!salt || !hash) return false;
	const computed = crypto.pbkdf2Sync(password, salt, 100000, 64, "sha512");
	let expected: Buffer;
	try {
		expected = Buffer.from(hash, "hex");
	} catch {
		return false;
	}
	// Comparación constant-time para evitar timing attacks
	return computed.length === expected.length && crypto.timingSafeEqual(computed, expected);
}

export function generateRandomCredentials(): { username: string; password: string } {
	return {
		username: `system_${crypto.randomBytes(4).toString("hex")}`,
		password: crypto.randomBytes(16).toString("hex"),
	};
}

export function shortId(): string {
	return crypto.randomBytes(6).toString("hex");
}
