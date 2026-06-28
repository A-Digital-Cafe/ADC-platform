import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { delimiter, isAbsolute, join } from 'node:path';

const PRESETS_FILE = 'presets/.presets.txt';

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

mkdirSync('presets', { recursive: true });

let ok = 0, skippedExists = 0, skippedNoAccess = 0, failed = 0;

function git(args, opts = {}) {
  return spawnSync(GIT_BIN, args, { encoding: 'utf8', env: { ...process.env, GIT_TERMINAL_PROMPT: '0' }, ...opts });
}

for (const rawLine of readFileSync(PRESETS_FILE, 'utf8').split('\n')) {
  const line = rawLine.trim();
  if (!line || line.startsWith('#')) continue;

  const [name = '', repo = '', ref = ''] = line.split(/\s+/);

  if (!name || !repo) {
    console.error(`  ⚠ línea inválida en ${PRESETS_FILE}: ${rawLine}`);
    continue;
  }

  const dir = `presets/${name}`;

  if (existsSync(dir)) {
    console.log(`  ✓ ${name} ya está presente (skip)`);
    skippedExists++;
    continue;
  }

  if (git(['ls-remote', repo]).status !== 0) {
    console.log(`  ⤬ ${name}: sin acceso o repo inaccesible (skip)`);
    skippedNoAccess++;
    continue;
  }

  console.log(`  ↓ clonando ${name} desde ${repo}${ref ? ` @ ${ref}` : ''}`);

  if (git(['clone', '--quiet', repo, dir]).status === 0) {
    if (ref && git(['-C', dir, 'checkout', '--quiet', ref]).status !== 0) {
      console.error(`    ⚠ no se pudo hacer checkout de ${ref} en ${name}`);
    }
    ok++;
  } else {
    console.error(`    ✗ clone falló para ${name}`);
    rmSync(dir, { recursive: true, force: true });
    failed++;
  }
}

console.log(`Presets: ${ok} clonados, ${skippedExists} existentes, ${skippedNoAccess} sin acceso, ${failed} fallidos.`);
