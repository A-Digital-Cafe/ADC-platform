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
import { closeSync, fstatSync, openSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { normalizeAddress } from "./email-address.ts";

const POLICY_PATH = fileURLToPath(new URL("../config/name-policy.json", import.meta.url));

interface RawSystemAlias {
	id?: string;
	labels?: string[];
	purpose?: string;
	defaultTarget?: string;
}

interface RawPolicy {
	systemAliases?: RawSystemAlias[];
	reservedUsernames?: string[];
	blockedWords?: string[];
	allowedExceptions?: string[];
	randomUsername?: { adjectives?: string[]; animals?: string[]; digits?: number };
}

/**
 * Familia de direcciones de sistema que comparten destino. `soporte` y `support` son la misma
 * casilla escrita en dos idiomas: agruparlas evita el estado imposible de que una redirija a una
 * persona y la otra a otra, que es el tipo de diferencia que nadie nota hasta que se pierde un
 * correo.
 * @public
 */
export interface SystemAliasGroup {
	id: string;
	/** Local-parts que entregan en el mismo lugar (`support`, `soporte`, …). */
	labels: string[];
	/** Para qué es, en una línea: lo muestra el panel al lado de cada grupo. */
	purpose: string;
	/** Buzón al que entrega mientras nadie configure otro destino desde el panel. */
	defaultTarget: string;
}

interface NamePolicy {
	/** Alias con clave normalizada: local-part suelto o dirección completa. */
	aliases: Map<string, string>;
	/** El catálogo agrupado, para el panel y para resolver a qué grupo pertenece una dirección. */
	groups: SystemAliasGroup[];
	reserved: Set<string>;
	blockedWords: string[];
	exceptions: Set<string>;
	randomUsername: { adjectives: string[]; animals: string[]; digits: number };
}

/** Motivo por el que un nombre no se puede usar. */
export type NameRejection = { reason: "reserved" | "blocked" | "format"; term: string };

/**
 * Alfanumérico ASCII con `.`, `_` y `-` en el medio, sin puntos consecutivos. No es cosmético: la
 * parte local del correo se deriva del username quitando lo que no sea `[a-z0-9._-]`, así que sin
 * este filtro "a@b" y "ab" colapsan en la MISMA casilla y la procedencia de un correo deja de ser
 * atribuible. La longitud (3–30) la valida cada punto de entrada.
 */
const USERNAME_FORMAT_RX = /^[a-zA-Z0-9][a-zA-Z0-9._-]*[a-zA-Z0-9]$/;

/** Slug de organización: se vuelve etiqueta de subdominio (`<slug>.<raíz>`), sin `.` ni `_`. */
const ORG_SLUG_FORMAT_RX = /^[a-z0-9][a-z0-9-]*[a-z0-9]$/;

const EMPTY_POLICY: NamePolicy = {
	aliases: new Map(),
	groups: [],
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
function normalizeName(value: string): string {
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
	const groups: SystemAliasGroup[] = [];
	for (const entry of raw.systemAliases ?? []) {
		const id = entry.id?.trim().toLowerCase();
		const target = entry.defaultTarget?.trim().toLowerCase();
		const labels = (entry.labels ?? []).map((l) => l.trim().toLowerCase()).filter(Boolean);
		if (!id || !target || labels.length === 0) continue;
		groups.push({ id, labels, purpose: entry.purpose?.trim() ?? "", defaultTarget: target });
		// Con `@` es una dirección completa; sin `@`, un local-part del dominio raíz.
		for (const label of labels) aliases.set(label.includes("@") ? normalizeAddress(label) : label, target);
	}

	// Cada alias queda reservado: nadie puede registrarse como `support` si
	// `support@…` ya entrega en otro buzón.
	const reserved = new Set<string>();
	for (const key of aliases.keys()) reserved.add(normalizeName(key.split("@")[0]));
	for (const name of raw.reservedUsernames ?? []) reserved.add(normalizeName(name));

	return {
		aliases,
		groups,
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
 *
 * El `stat` y la lectura van sobre el **mismo descriptor**: si se resolvieran dos
 * veces por ruta, una reescritura entre medio dejaría el contenido nuevo cacheado
 * bajo el `mtime` viejo (o al revés, el viejo bajo el nuevo, que no se recupera).
 */
function getNamePolicy(): NamePolicy {
	let fd: number | undefined;
	try {
		fd = openSync(POLICY_PATH, "r");
		const mtimeMs = fstatSync(fd).mtimeMs;
		if (mtimeMs !== cachedMtimeMs) {
			cached = parsePolicy(JSON.parse(readFileSync(fd, "utf8")) as RawPolicy);
			cachedMtimeMs = mtimeMs;
		}
	} catch {
		// Se mantiene la política ya cargada.
	} finally {
		if (fd !== undefined) closeSync(fd);
	}
	return cached;
}

/**
 * `null` si el username se puede usar, o el motivo: `format` (ver {@link USERNAME_FORMAT_RX}),
 * `reserved` (exacto) o `blocked` (malas palabras por subcadena, salvo excepciones).
 *
 * Se aplica sólo a nombres que la persona ELIGE. En el alta por OAuth el nombre lo trae el
 * proveedor, así que rechazar no sirve: ese flujo genera uno propio con este mismo check.
 */
export function checkUsername(username: string): NameRejection | null {
	const policy = getNamePolicy();
	if (!USERNAME_FORMAT_RX.test(username) || username.includes("..")) return { reason: "format", term: username };

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
	// El formato lo revalida el DAO al crear; acá va también para que el endpoint
	// público `check-slug` no diga "disponible" sobre algo que después rechaza el alta.
	if (!ORG_SLUG_FORMAT_RX.test(slug.trim().toLowerCase())) return { reason: "format", term: slug };

	const normalized = normalizeName(slug);
	if (!normalized) return { reason: "blocked", term: slug };
	if (SENTINEL_SLUGS.has(normalized) || getNamePolicy().reserved.has(normalized)) return { reason: "reserved", term: normalized };
	return null;
}

/**
 * Username de la plataforma al que entrega una dirección, o `null` si no es un
 * alias. Acepta subaddressing (`support+ventas@…` sigue siendo `support`).
 * @public
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
 * El catálogo de direcciones de sistema, agrupado. Lo consume el panel para ofrecer un destino por
 * grupo, y el correo para saber a qué grupo pertenece una dirección entrante.
 * @public
 */
export function listSystemAliasGroups(): readonly SystemAliasGroup[] {
	return getNamePolicy().groups;
}

/**
 * Grupo de sistema al que pertenece una dirección, o `null` si no es una de ellas. Mismo criterio
 * que {@link resolveAliasTarget} —acepta subaddressing y los local-parts sueltos sólo valen en el
 * dominio raíz— para que el panel y la entrega nunca discrepen sobre qué es una casilla de sistema.
 * @public
 */
export function resolveAliasGroup(address: string, rootDomain: string): SystemAliasGroup | null {
	const policy = getNamePolicy();
	if (policy.groups.length === 0) return null;

	const normalized = normalizeAddress(address);
	const at = normalized.lastIndexOf("@");
	const local = at > 0 && normalized.slice(at + 1) === rootDomain.trim().toLowerCase() ? normalized.slice(0, at) : null;

	return policy.groups.find((g) => g.labels.some((label) => label === normalized || (local !== null && label === local))) ?? null;
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
