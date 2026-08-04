import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
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
  return spawnSync(GIT_BIN, [...PROTOCOL_ARGS, ...args], {
    encoding: 'utf8',
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_ALLOW_PROTOCOL: ALLOWED_PROTOCOLS },
    ...opts,
  });
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
    console.log(`  ⤬ ${name}: sin acceso o repo inaccesible (skip)`);
    skippedNoAccess++;
    continue;
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
