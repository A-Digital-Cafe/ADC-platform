import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { delimiter, isAbsolute, join, resolve, sep } from 'node:path';

const PRESETS_FILE = 'presets/.presets.txt';
const PRESETS_DIR = 'presets';

if (!existsSync(PRESETS_FILE)) process.exit(0);

// Resolve the git executable to an absolute path so we never rely on PATH at
// spawn time: a writable or relative (cwd-controlled) PATH entry could otherwise
// shadow `git` with a malicious binary that would run during postinstall.
function resolveGit() {
  const exeNames = process.platform === 'win32' ? ['git.exe', 'git.cmd', 'git'] : ['git'];
  for (const dir of (process.env.PATH ?? '').split(delimiter)) {
    if (!dir || !isAbsolute(dir)) continue; // skip relative/writable PATH entries
    for (const exe of exeNames) {
      const full = join(dir, exe);
      if (existsSync(full)) return full;
    }
  }
  return null;
}

const GIT_BIN = resolveGit();
if (!GIT_BIN) {
  console.error('  ⚠ git no encontrado en PATH; se omite la sincronización de presets.');
  process.exit(0);
}

// This script runs from `postinstall`, so every value it reads out of
// `.presets.txt` reaches `git` with zero user interaction. Two things are
// therefore validated before any spawn:
//
//  - The transport. Git URLs are not just locations: `ext::<command>` runs an
//    arbitrary command as the transport helper. The scheme allowlist rejects it,
//    and `protocol.allow=never` (below) rejects it again at git level in case a
//    future edit loosens the regex. `file://` is refused too — a preset is always
//    a remote.
//  - The leading dash. `git ls-remote --upload-pack=<cmd>` executes <cmd>, and a
//    repo field is just an argv slot: an entry starting with `-` becomes an
//    option, not a URL. Verified reproducible on git 2.43. The regexes reject it
//    and every URL/ref is additionally passed after `--`.
//
// The directory name is validated separately: `presets/${name}` with an
// unchecked name is a path traversal in the clone destination.
const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const REPO_RE = /^(?:https:\/\/|ssh:\/\/[^\s@]+@|ssh:\/\/|git@[^\s:/]+:)[^\s]+$/;
const REF_RE = /^[A-Za-z0-9][A-Za-z0-9._/-]*$/;
const SHA_RE = /^[0-9a-f]{40}$/i;

/** Sin `..` ni separadores: `presets/<name>` tiene que quedar dentro de `presets/`. */
function isSafeName(name) {
  return NAME_RE.test(name) && !name.includes('..') && !name.includes('/') && !name.includes('\\');
}

function isSafeRepo(repo) {
  return REPO_RE.test(repo) && !repo.includes('..');
}

function isSafeRef(ref) {
  return REF_RE.test(ref) && !ref.includes('..') && !ref.endsWith('.lock');
}

/** El destino resuelto tiene que estar contenido en `presets/` (defensa en profundidad). */
function isInsidePresets(dir) {
  const base = resolve(PRESETS_DIR) + sep;
  return resolve(dir).startsWith(base);
}

mkdirSync(PRESETS_DIR, { recursive: true });

let ok = 0, skippedExists = 0, skippedNoAccess = 0, failed = 0, invalid = 0;
const mutableRefs = [];

// Doble candado de transporte. `GIT_ALLOW_PROTOCOL` es el que manda: `protocol.allow`
// es sólo el *fallback* para protocolos sin clave propia, así que un `~/.gitconfig` con
// `protocol.ext.allow=always` lo pisa (verificado en git 2.43: con esa clave el helper
// `ext::` corre igual). La variable de entorno gana incluso en ese caso, y de paso
// bloquea `file://`. Los `-c` quedan como red por si la variable se pierde en algún wrapper.
const ALLOWED_PROTOCOLS = 'https:ssh';
const PROTOCOL_ARGS = [
  '-c', 'protocol.allow=never',
  '-c', 'protocol.https.allow=always',
  '-c', 'protocol.ssh.allow=always',
];

function git(args, opts = {}) {
  const env = { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_ALLOW_PROTOCOL: ALLOWED_PROTOCOLS };
  if (githubToken) {
    // El token viaja en el ENV del proceso hijo (no argv → no aparece en `ps`; no se
    // escribe en ningún .git/config). Clave acotada a github.com para no mandarle el
    // header a otros hosts.
    const basic = Buffer.from(`x-access-token:${githubToken}`, 'utf8').toString('base64');
    env.GIT_CONFIG_COUNT = '1';
    env.GIT_CONFIG_KEY_0 = 'http.https://github.com/.extraheader';
    env.GIT_CONFIG_VALUE_0 = `Authorization: Basic ${basic}`;
  }
  return spawnSync(GIT_BIN, [...PROTOCOL_ARGS, ...args], { encoding: 'utf8', env, ...opts });
}

// ── Autorización GitHub (device flow, human-in-the-loop) ──────────────────────
// Sin credenciales residentes: si un repo no se puede leer anónimamente y hay una
// consola interactiva, se corre el device flow de GitHub — el script imprime un
// código, la persona lo autoriza en el navegador con su cuenta, y el user access
// token resultante vive SOLO en la memoria de este proceso (nunca disco, nunca
// argv). Requiere el Client ID de la GitHub App en `.env` (ADC_GITHUB_CLIENT_ID:
// identificador público, no credencial). Sin TTY o sin Client ID, se mantiene el
// comportamiento de siempre: los repos sin acceso se omiten en silencio.

/** Client ID de la GitHub App, desde el `.env` de la raíz (o el env del proceso). */
function resolveGithubClientId() {
  if (process.env.ADC_GITHUB_CLIENT_ID?.trim()) return process.env.ADC_GITHUB_CLIENT_ID.trim();
  let envFile;
  try {
    envFile = readFileSync('.env', 'utf8');
  } catch {
    return '';
  }
  for (const line of envFile.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('ADC_GITHUB_CLIENT_ID=')) continue;
    let value = trimmed.slice('ADC_GITHUB_CLIENT_ID='.length).trim();
    const quote = value[0];
    if ((quote === '"' || quote === "'") && value.length >= 2 && value.endsWith(quote)) {
      value = value.slice(1, -1);
    } else {
      const hash = value.indexOf('#');
      if (hash >= 0) value = value.slice(0, hash);
    }
    return value.trim();
  }
  return '';
}

/** Client ID vigente; si falta en el .env se pregunta por consola (una vez). */
let GITHUB_CLIENT_ID = resolveGithubClientId();
/** Token de acceso vigente (solo memoria de este proceso), o null. */
let githubToken = null;
/** El device flow se intenta UNA vez por corrida: si se declina, no se insiste por repo. */
let githubAuthAttempted = false;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Corre el device flow completo por consola. Devuelve el token, o null. */
async function githubDeviceFlow() {
  const headers = { 'Content-Type': 'application/json', Accept: 'application/json' };
  let start;
  try {
    const res = await fetch('https://github.com/login/device/code', {
      method: 'POST',
      headers,
      body: JSON.stringify({ client_id: GITHUB_CLIENT_ID }),
    });
    start = await res.json();
    if (!res.ok || !start.device_code) {
      const reason = start.error ?? `HTTP ${res.status}`;
      console.error(`  ⚠ GitHub no inició el device flow: ${reason}`);
      return null;
    }
  } catch (e) {
    console.error(`  ⚠ no se pudo contactar a GitHub para el device flow: ${e?.message ?? e}`);
    return null;
  }
  console.log('');
  console.log('  🔑 Hay presets que requieren autorización de GitHub para clonarse.');
  console.log(`     Abrí ${start.verification_uri} e ingresá el código: ${start.user_code}`);
  console.log('     Esperando autorización… (Ctrl+C para saltear; los presets sin acceso se omiten)');
  const deadline = Date.now() + (start.expires_in ?? 900) * 1000;
  let intervalMs = (start.interval ?? 5) * 1000;
  while (Date.now() < deadline) {
    await sleep(intervalMs);
    let poll;
    try {
      const res = await fetch('https://github.com/login/oauth/access_token', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          client_id: GITHUB_CLIENT_ID,
          device_code: start.device_code,
          grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
        }),
      });
      poll = await res.json();
    } catch {
      continue; // error de red: reintentar en el próximo intervalo
    }
    // El refresh_token (si viene) se descarta adrede: nada de credenciales de larga vida.
    if (poll.access_token) {
      console.log('  ✓ GitHub autorizado.\n');
      return poll.access_token;
    }
    if (poll.error === 'authorization_pending') continue;
    if (poll.error === 'slow_down') {
      intervalMs = (poll.interval ?? 10) * 1000;
      continue;
    }
    console.error(`  ⚠ device flow terminado sin autorización: ${poll.error ?? 'respuesta inesperada'}`);
    return null;
  }
  console.error('  ⚠ el código de autorización expiró sin completarse.');
  return null;
}

/**
 * Pregunta el Client ID por consola (clon fresco sin `.env`, típicamente). Es un
 * identificador público de la App, no una credencial. Vacío/ inválido = saltear.
 */
async function promptGithubClientId() {
  const { createInterface } = await import('node:readline/promises');
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    console.log('  ⓘ Hay presets que no se pueden clonar anónimamente y no hay ADC_GITHUB_CLIENT_ID en el .env.');
    console.log('    (Es el Client ID público de la GitHub App; guía: docs/guides/github-deploy-auth.md)');
    const answer = (await rl.question('    Client ID de la GitHub App [Enter para saltear]: ')).trim();
    if (!answer) return '';
    if (!/^[A-Za-z0-9._-]+$/.test(answer)) {
      console.error('  ⚠ Client ID con formato inesperado: se ignora.');
      return '';
    }
    return answer;
  } finally {
    rl.close();
  }
}

/**
 * Guarda el Client ID en el `.env` (creándolo si no existe) para no volver a preguntarlo.
 * Sólo se llama tras una autorización EXITOSA: un ID mal tipeado no queda persistido.
 */
function persistGithubClientId(clientId) {
  try {
    let current = '';
    try {
      current = readFileSync('.env', 'utf8');
    } catch {
      // Sin .env: se crea con el append de abajo.
    }
    const line = `ADC_GITHUB_CLIENT_ID=${clientId}`;
    if (/^\s*ADC_GITHUB_CLIENT_ID\s*=.*$/m.test(current)) {
      // Existía la clave pero vacía (por eso se preguntó): reemplazar en el lugar.
      writeFileSync('.env', current.replace(/^\s*ADC_GITHUB_CLIENT_ID\s*=.*$/m, line));
    } else {
      const nl = current.length > 0 && !current.endsWith('\n') ? '\n' : '';
      appendFileSync('.env', `${nl}# GitHub App para autorizar deploys y clones de presets (guardado por sync-presets)\n${line}\n`);
    }
    console.log('  ✓ Client ID guardado en .env (ADC_GITHUB_CLIENT_ID).');
  } catch (e) {
    console.error(`  ⚠ no se pudo guardar el Client ID en .env: ${e?.message ?? e}`);
  }
}

/** Pide autorización interactiva (una sola vez). Devuelve el token vigente, o null. */
async function ensureGithubAuth() {
  if (githubToken || githubAuthAttempted) return githubToken;
  githubAuthAttempted = true;
  if (!process.stdout.isTTY || !process.stdin.isTTY) {
    console.log('  ⓘ Sin consola interactiva: no se puede autorizar GitHub (se omiten los repos sin acceso).');
    return null;
  }
  let promptedClientId = false;
  if (!GITHUB_CLIENT_ID) {
    GITHUB_CLIENT_ID = await promptGithubClientId();
    if (!GITHUB_CLIENT_ID) {
      console.log('  ⓘ Sin Client ID: se omiten los repos sin acceso.');
      return null;
    }
    promptedClientId = true;
  }
  githubToken = await githubDeviceFlow();
  if (githubToken && promptedClientId) persistGithubClientId(GITHUB_CLIENT_ID);
  return githubToken;
}

for (const rawLine of readFileSync(PRESETS_FILE, 'utf8').split('\n')) {
  const line = rawLine.trim();
  if (!line || line.startsWith('#')) continue;

  const [name = '', repo = '', ref = ''] = line.split(/\s+/);

  if (!name || !repo) {
    console.error(`  ⚠ línea inválida en ${PRESETS_FILE}: ${rawLine}`);
    invalid++;
    continue;
  }

  if (!isSafeName(name)) {
    console.error(`  ✗ nombre de preset inválido (se omite): ${JSON.stringify(name)}`);
    invalid++;
    continue;
  }

  if (!isSafeRepo(repo)) {
    console.error(`  ✗ ${name}: URL de repo rechazada (sólo https://, ssh:// o git@host:path)`);
    invalid++;
    continue;
  }

  if (ref && !isSafeRef(ref)) {
    console.error(`  ✗ ${name}: ref inválida (se omite el preset)`);
    invalid++;
    continue;
  }

  const dir = `${PRESETS_DIR}/${name}`;

  if (!isInsidePresets(dir)) {
    console.error(`  ✗ ${name}: el destino del clone queda fuera de ${PRESETS_DIR}/ (se omite)`);
    invalid++;
    continue;
  }

  if (existsSync(dir)) {
    console.log(`  ✓ ${name} ya está presente (skip)`);
    skippedExists++;
    continue;
  }

  if (git(['ls-remote', '--', repo]).status !== 0) {
    // Puede ser un repo privado: ofrecer el device flow (una vez) y reintentar con token.
    const retryable = repo.startsWith('https://github.com/') && (await ensureGithubAuth()) !== null;
    if (!retryable || git(['ls-remote', '--', repo]).status !== 0) {
      console.log(`  ⤬ ${name}: sin acceso o repo inaccesible (skip)`);
      skippedNoAccess++;
      continue;
    }
  }

  console.log(`  ↓ clonando ${name}${ref ? ' @ ' + ref : ''}`);

  if (git(['clone', '--quiet', '--', repo, dir]).status === 0) {
    if (ref && git(['-C', dir, 'checkout', '--quiet', ref, '--']).status !== 0) {
      console.error(`    ⚠ no se pudo hacer checkout de ${ref} en ${name}`);
    } else if (SHA_RE.test(ref)) {
      // Ref pineada: confirmar que HEAD quedó exactamente ahí.
      const head = git(['-C', dir, 'rev-parse', 'HEAD']).stdout?.trim();
      if (head && head.toLowerCase() !== ref.toLowerCase()) {
        console.error(`    ✗ ${name}: HEAD (${head.slice(0, 12)}) no coincide con la ref pineada; se descarta`);
        rmSync(dir, { recursive: true, force: true });
        failed++;
        continue;
      }
    } else {
      // Rama (o rama por defecto del remoto): lo clonado depende de dónde apunte hoy.
      mutableRefs.push(`${name}@${ref || 'rama por defecto'}`);
    }
    ok++;
  } else {
    console.error(`    ✗ clone falló para ${name}`);
    rmSync(dir, { recursive: true, force: true });
    failed++;
  }
}

console.log(
  `Presets: ${ok} clonados, ${skippedExists} existentes, ${skippedNoAccess} sin acceso, ${failed} fallidos` +
    (invalid ? `, ${invalid} inválidos` : '') + '.'
);

if (mutableRefs.length > 0) {
  console.warn(
    `  ⚠ ${mutableRefs.length} preset(s) siguen una rama mutable (${mutableRefs.join(', ')}): ` +
      `lo que se clone depende de dónde apunte esa rama en ese momento. ` +
      `Poné un SHA de 40 hex en la 3ra columna de ${PRESETS_FILE} para pinear (se verifica tras el clone).`
  );
}
