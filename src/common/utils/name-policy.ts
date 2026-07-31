/**
 * Política de nombres de la plataforma (única fuente de verdad).
 *
 * Une dos reglas que en realidad son la misma: qué nombres NO puede tomar un
 * usuario (y por tanto tampoco su dirección de correo, que se deriva del
 * username) y qué direcciones son **alias** que entregan en el buzón de otro.
 *
 * Los datos viven en `src/common/config/name-policy.json`, editable en caliente.
 * La usan `SessionManagerService` (registro y OAuth), `IdentityManagerService`
 * (cambio de username) y el `EmailService` (entrega y validación de envío).
 */
import { readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { normalizeAddress } from "./email-address.ts";

const POLICY_PATH = fileURLToPath(new URL("../config/name-policy.json", import.meta.url));

interface RawPolicy {
	aliases?: Record<string, string>;
	reservedUsernames?: string[];
	blockedWords?: string[];
	allowedExceptions?: string[];
	randomUsername?: { adjectives?: string[]; animals?: string[]; digits?: number };
}

export interface NamePolicy {
	/** Alias con clave normalizada: local-part suelto o dirección completa. */
	aliases: Map<string, string>;
	reserved: Set<string>;
	blockedWords: string[];
	exceptions: Set<string>;
	randomUsername: { adjectives: string[]; animals: string[]; digits: number };
}

/** Motivo por el que un nombre no se puede usar. */
export type NameRejection = { reason: "reserved" | "blocked"; term: string };

const EMPTY_POLICY: NamePolicy = {
	aliases: new Map(),
	reserved: new Set(),
	blockedWords: [],
	exceptions: new Set(),
	randomUsername: { adjectives: [], animals: [], digits: 3 },
};

let cached: NamePolicy = EMPTY_POLICY;
let cachedMtimeMs = -1;

/**
 * Deshace el leet y quita separadores para que `adm1n`, `a-d-m-i-n` y `admin`
 * colapsen al mismo texto. Se aplica a los términos de la lista y al candidato,
 * así la comparación es simétrica.
 */
export function normalizeName(value: string): string {
	return value
		.toLowerCase()
		.replaceAll(/[4@]/g, "a")
		.replaceAll("3", "e")
		.replaceAll("1", "i")
		.replaceAll("!", "i")
		.replaceAll("0", "o")
		.replaceAll(/[5$]/g, "s")
		.replaceAll("7", "t")
		.replaceAll(/[^a-z0-9]/g, "");
}

function parsePolicy(raw: RawPolicy): NamePolicy {
	const aliases = new Map<string, string>();
	for (const [key, target] of Object.entries(raw.aliases ?? {})) {
		const trimmed = key.trim().toLowerCase();
		if (!trimmed || !target) continue;
		// Con `@` es una dirección completa; sin `@`, un local-part del dominio raíz.
		aliases.set(trimmed.includes("@") ? normalizeAddress(trimmed) : trimmed, target.trim().toLowerCase());
	}

	// Cada alias queda reservado: nadie puede registrarse como `support` si
	// `support@…` ya entrega en otro buzón.
	const reserved = new Set<string>();
	for (const key of aliases.keys()) reserved.add(normalizeName(key.split("@")[0]));
	for (const name of raw.reservedUsernames ?? []) reserved.add(normalizeName(name));

	return {
		aliases,
		reserved,
		blockedWords: (raw.blockedWords ?? []).map(normalizeName).filter(Boolean),
		exceptions: new Set((raw.allowedExceptions ?? []).map(normalizeName)),
		randomUsername: {
			adjectives: raw.randomUsername?.adjectives ?? [],
			animals: raw.randomUsername?.animals ?? [],
			digits: raw.randomUsername?.digits ?? 3,
		},
	};
}

/**
 * Política vigente. Relee el archivo sólo si cambió su `mtime`, así el coste por
 * llamada es un `stat`. Si el archivo falta o está corrupto devuelve la última
 * política válida (o una vacía): una config rota no debe tirar el registro.
 */
export function getNamePolicy(): NamePolicy {
	try {
		const mtimeMs = statSync(POLICY_PATH).mtimeMs;
		if (mtimeMs !== cachedMtimeMs) {
			cached = parsePolicy(JSON.parse(readFileSync(POLICY_PATH, "utf8")) as RawPolicy);
			cachedMtimeMs = mtimeMs;
		}
	} catch {
		// Se mantiene la política ya cargada.
	}
	return cached;
}

/**
 * Comprueba si un username se puede usar. Devuelve `null` si es válido o el
 * motivo del rechazo. Los reservados se comparan exactos; las malas palabras,
 * por subcadena (salvo que el nombre esté en las excepciones).
 */
export function checkUsername(username: string): NameRejection | null {
	const policy = getNamePolicy();
	const normalized = normalizeName(username);
	if (!normalized) return { reason: "blocked", term: username };

	if (policy.reserved.has(normalized)) return { reason: "reserved", term: normalized };
	if (policy.exceptions.has(normalized)) return null;

	for (const word of policy.blockedWords) {
		if (normalized.includes(word)) return { reason: "blocked", term: word };
	}
	return null;
}

/**
 * Centinelas que la plataforma compara como texto plano contra un `orgId`: `default` (contexto
 * global) y `personal` (`PERSONAL_ORG_ID`). Van en código y no en el JSON porque la política se lee
 * best-effort, y un archivo roto no puede reabrir la colisión.
 */
const SENTINEL_SLUGS = new Set(["default", "personal"]);

/**
 * Comprueba si una organización puede tomar un slug. Además de los centinelas,
 * rechaza los nombres reservados de la política: el slug se vuelve subdominio
 * (`<slug>.<raíz>`), así que `admin`, `api` o `postmaster` como organización
 * son tan indeseables como usernames.
 */
export function checkOrgSlug(slug: string): NameRejection | null {
	const normalized = normalizeName(slug);
	if (!normalized) return { reason: "blocked", term: slug };
	if (SENTINEL_SLUGS.has(normalized) || getNamePolicy().reserved.has(normalized)) return { reason: "reserved", term: normalized };
	return null;
}

/**
 * Username de la plataforma al que entrega una dirección, o `null` si no es un
 * alias. Acepta subaddressing (`support+ventas@…` sigue siendo `support`).
 */
export function resolveAliasTarget(address: string, rootDomain: string): string | null {
	const policy = getNamePolicy();
	if (policy.aliases.size === 0) return null;

	const normalized = normalizeAddress(address);
	const full = policy.aliases.get(normalized);
	if (full) return full;

	const at = normalized.lastIndexOf("@");
	if (at <= 0) return null;
	// Los alias sin dominio sólo aplican al dominio raíz, no a los de organización.
	if (normalized.slice(at + 1) !== rootDomain.trim().toLowerCase()) return null;
	return policy.aliases.get(normalized.slice(0, at)) ?? null;
}

/**
 * Username autogenerado `<adjetivo><Animal><dígitos>` para altas por OAuth cuyo
 * nombre de origen está bloqueado: en ese flujo el nombre no lo elige la persona,
 * así que rechazar el login sería peor que renombrarla.
 */
export function generateRandomUsername(randomInt: (maxExclusive: number) => number): string {
	const { adjectives, animals, digits } = getNamePolicy().randomUsername;
	const adjective = adjectives[randomInt(adjectives.length)] ?? "quiet";
	const animal = animals[randomInt(animals.length)] ?? "otter";
	const max = 10 ** Math.max(1, digits);
	const number = String(randomInt(max)).padStart(Math.max(1, digits), "0");
	return `${adjective}${animal.charAt(0).toUpperCase()}${animal.slice(1)}${number}`;
}
