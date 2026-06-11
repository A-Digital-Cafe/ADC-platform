import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const PRESETS_FILE = 'presets/.presets.txt';

if (!existsSync(PRESETS_FILE)) process.exit(0);

mkdirSync('presets', { recursive: true });

let ok = 0, skippedExists = 0, skippedNoAccess = 0, failed = 0;

function git(args, opts = {}) {
  return spawnSync('git', args, { encoding: 'utf8', env: { ...process.env, GIT_TERMINAL_PROMPT: '0' }, ...opts });
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
