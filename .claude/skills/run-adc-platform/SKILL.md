---
name: run-adc-platform
description: Build, run, and drive the ADC Platform kernel and its federated web UI. Use when asked to start ADC Platform, boot the kernel, run it in dev, take a screenshot of an app (home, auth, drive, image-editor…), click through the UI, smoke-test the apps, or stop/clean up the dev servers.
---

ADC Platform is a modular kernel: `bun run dev` boots it as a gateway on
**:3000** that redirects to the default app and spins up every app on its own
rspack dev-server port (see [docs/guides/ports.md](docs/guides/ports.md)).
There is no GUI window — you drive it headless via
`.claude/skills/run-adc-platform/driver.mjs` (a dependency-free Node script that
shells out to `google-chrome` and talks Chrome DevTools Protocol). All paths
below are relative to the repo root.

## Prerequisites

This container already had everything; there was **no `apt-get` step**. Verify
presence (these are the exact checks that passed here):

```bash
bun --version           # 1.3.13
node --version          # v24.15.0  (runs the driver + repo scripts)
google-chrome --version # 137.x      (the driver's browser)
docker ps               # daemon must be up — kernel auto-provisions its backing services
```

The kernel **auto-provisions its backing services as Docker containers** on
boot (mongo `:27017`, redis, minio/S3 `:9000-9001`, rabbitmq, haraka). You do
not start them by hand — just have the Docker daemon running. They persist
between runs. On a fresh Ubuntu without Chrome:
`sudo apt-get install -y google-chrome-stable` (or point `$CHROME_BIN` at any
Chromium).

## Setup

Dependencies install per-workspace via bun. On a fresh clone:

```bash
bun install   # runs postinstall (scripts/sync-presets.mjs) — syncs preset git repos
```

(Already installed in this container — `node_modules/` present.) No env file is
required; `.env` already exists with sane dev defaults.

## Run (agent path)

**1. Launch the kernel in the background and wait for the ready marker.** Clean
boot takes ~65s (UIFederation binds :3000 early, then ~14 rspack dev servers
compile):

```bash
nohup bun run dev > /tmp/adc-dev.log 2>&1 &
echo $! > /tmp/adc-dev.pid
timeout 150 bash -c 'until grep -q "Kernel en funcionamiento" /tmp/adc-dev.log; do sleep 1; done' \
  && echo "ready" || tail -20 /tmp/adc-dev.log
```

**2. Drive it with the driver.** Screenshots land in `/tmp/adc-shots/`.

```bash
# health-check every app port + screenshot home / auth / community-home:
node .claude/skills/run-adc-platform/driver.mjs smoke

# one screenshot of any route:
node .claude/skills/run-adc-platform/driver.mjs shot http://localhost:3024/ home

# navigate + interact + screenshot (CDP): here, open home and click "Ingresar"
# (login) — lands on the auth app and screenshots it:
node .claude/skills/run-adc-platform/driver.mjs drive http://localhost:3024/ login-flow \
  --wait "button" --click "button" --settle 1500 --eval "document.title"
```

**Logged-in testing.** In dev the kernel seeds two test users (idempotent, every
boot): a **global admin** (`devadmin`) and an **org admin** (`devorgadmin`, in
org `dev-org`). Log in as them to exercise authenticated UI — the driver POSTs
to `/api/auth/login` from inside the page and the auth cookie (domain
`localhost`) then applies across every app port:

```bash
# screenshot an app as the global admin:
node .claude/skills/run-adc-platform/driver.mjs login admin http://localhost:3014/ identity-as-admin

# or authenticate first, then drive/interact in the same session:
node .claude/skills/run-adc-platform/driver.mjs drive http://localhost:3024/ home-authed \
  --login orgadmin --wait "body" --settle 1500
```

Presets: `admin` (global) · `orgadmin` (org `dev-org`). Custom users seeded via
`DEV_USERS` (below) work too with `'username::password[::orgId]'`.

| command | what it does |
|---|---|
| `smoke` | curl gateway + all 17 app ports (status < 500 = OK), screenshot home/auth/community-home; exits non-zero on any problem |
| `shot <url> [name]` | one-shot headless screenshot → `/tmp/adc-shots/<name>.png` |
| `login <who> [url] [name]` | log in as a dev user (`admin` \| `orgadmin` \| `'user::pass[::orgId]'`), navigate to `url`, screenshot. Dev only |
| `drive <url> [name]` | CDP session; `--login who` (authenticate first), `--wait "sel"`, `--click "sel"`, `--type "sel::text"`, `--eval "jsExpr"`, `--settle ms`. Ends in a screenshot + prints `document.title` and any page exceptions |
| `stop` | kill kernel + all rspack dev servers, free ports 3000–3034 (leaves Docker S3 on :9000/:9001) |

> Dev test users live in `src/services/core/IdentityManagerService/defaults/devUsers.ts`
> (`DEV_USERS`). Add an entry there to seed another user with specific roles; mirror
> the credentials in `driver.mjs`'s `DEV_USERS` map to get a login preset.

Key dev ports: gateway `3000` · adc-home `3024` · adc-auth `3012` ·
community-home `3010` · adc-identity `3014` · adc-drive `3032` ·
image-editor `3034`. Full map: [docs/guides/ports.md](docs/guides/ports.md).

**3. Stop cleanly — always via the driver, never Ctrl-C or `bun run cleanup`** (see Gotchas):

```bash
node .claude/skills/run-adc-platform/driver.mjs stop
```

## Run (human path)

`bun run dev` in a foreground terminal, then open `http://localhost:3000` in a
real browser (redirects to the default app). Ctrl-C to quit — but note bun does
**not** forward the signal to the kernel child, so it orphans holding :3000;
run the driver's `stop` afterward. Useless headless, hence the agent path above.

## Test

There is no standalone unit-test runner. In dev mode (`ENABLE_TESTS=true`, set
by `bun run dev`) several modules self-test on boot — e.g. `user-profile-mongo`
logs `=============== PRUEBAS COMPLETADAS ===============` after exercising the
identity/permissions flow against Mongo. Watch `/tmp/adc-dev.log` for those.
Static checks: `bun run typecheck` (note: **exits 1 by baseline** due to knip
unused-export reporting — read the output, don't treat exit code as failure)
and `bun run lint` (zero-warnings, src only).

## Gotchas

- **Never run `bun run cleanup`, or any bare `pkill -f rspack` / `pkill -f "bun src/index.ts"`, from your shell.** `pkill -f` matches by full command line, and the pattern text is sitting in *your own shell's argv* — so it kills the shell mid-command (you get empty output + exit 1, and a half-done cleanup). The repo's `cleanup` script additionally does `pkill -9 -f "ADC-platform"`, which matches any agent command that `cd`'d into the project path. **Use `driver.mjs stop`** — it spawns the kills as child processes with clean argv, and pkill auto-excludes itself.
- **bun orphans the kernel on exit.** It doesn't propagate SIGINT/SIGTERM to the `bun src/index.ts` child, which keeps holding :3000. Killing the `bun run dev` pid alone is not enough — always finish with `driver.mjs stop`.
- **`UIFederationService no encontrado` spammed everywhere + `Failed to start server. Is port 3000 in use?`** means a **stale instance already owns :3000**. The kernel still reaches "Kernel en funcionamiento" but serves no UI. Fix: `driver.mjs stop`, then relaunch.
- **First nav to an app can be slow.** rspack dev servers compile lazily; `:3000` is up long before an app's port is. The driver's `--wait`/virtual-time-budget absorbs this — don't replace it with a fixed `sleep`.
- **`test/home` (:3002) returns 404 at `/`** — it serves under a sub-path. `smoke` counts it OK (status < 500); it is not a failure.
- **Backing services are shared Docker containers**, auto-provisioned and persistent. S3 lives on `:9000/:9001` (refCount-shared) — `stop` deliberately leaves them alone.

## Troubleshooting

- **Driver/stop command prints nothing and exits 1**: you ran a `pkill -f`/`bun run cleanup` whose pattern is in the shell's own command line — it killed itself. Re-run the stop via `node .claude/skills/run-adc-platform/driver.mjs stop`.
- **Screenshot is blank or shows an error**: that app's rspack server is still compiling, or the route 500s. Re-run `drive` with `--wait "<selector you expect>"`, check `/tmp/adc-dev.log`, and look at the `page exceptions:` line the driver prints.
- **`EADDRINUSE` / port 3000 in use on launch**: leftover kernel from a prior run. `node .claude/skills/run-adc-platform/driver.mjs stop`, then relaunch.
- **Apps that need Mongo log connection errors**: confirm the Docker daemon is up and `adc-mongo-core` is running (`docker ps`); the kernel provisions it but cannot if Docker is down.
