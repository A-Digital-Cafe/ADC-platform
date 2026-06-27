---
name: run-adc-platform
description: Build, run, and drive the ADC Platform kernel and its federated web UI. Use when asked to start ADC Platform, boot the kernel, run it in dev, take a screenshot of an app (home, auth, drive, image-editor…), click through the UI, smoke-test the apps, or stop/clean up the dev servers.
---

ADC Platform is a modular kernel: `bun run dev` boots a gateway on **:3000** that
redirects to the default app and spins up every app on its own rspack dev-server
port ([docs/guides/ports.csv](docs/guides/ports.csv) — the single source of truth
the driver and `bun run cleanup` both read). No GUI window: drive it headless via
`driver.mjs` (dependency-free Node, shells out to `google-chrome` over the Chrome
DevTools Protocol; logic is split under `./utils`). All paths are repo-root
relative; run the driver as `node .claude/skills/run-adc-platform/driver.mjs <cmd>`.

## Prerequisites & setup

Already provisioned in this container (no `apt-get` / `bun install` needed). On a
fresh box: `bun --version` (1.3+), `node --version` (24+, runs the driver),
`google-chrome --version` (137+, or point `$CHROME_BIN` at any Chromium),
`docker ps` (daemon up). `bun install` runs `postinstall` (syncs presets);
`sudo apt-get install -y google-chrome-stable` if Chrome is missing.

The kernel **auto-provisions its backing services as Docker containers** on boot
(mongo `:27017`, redis, minio/S3 `:9000-9001`, rabbitmq, haraka) — just have the
Docker daemon running; they persist between runs. No `.env` needed (sane dev
defaults exist).

## Run (agent path)

**Just need "does it boot cleanly?"** → `boot-check`: one self-contained
foreground call (no background, no temp logs — both get reaped in sandboxed
shells). It boots `bun src/index.ts` directly and streams each kernel-mode
service start, the ready marker, the dev self-test, and any capability/scope
failure, then frees the ports. PASS (exit 0) = ready marker with zero
capability/scope failures; it does **not** start the rspack UI servers. Run it
from a single Bash call with a tool timeout > budget (budget 90 → timeout ~130s).

```bash
node .claude/skills/run-adc-platform/driver.mjs boot-check        # ~100s budget   (or: boot-check 60)
```

**Boot for real + wait until :3000 actually serves** (clean boot ~65s: :3000
binds early, then ~14 rspack servers compile). `ready` polls :3000 for a real
HTTP response — stronger than grepping the log marker (a stale instance can reach
the marker while serving nothing):

```bash
nohup bun run dev > /tmp/adc-dev.log 2>&1 &
node .claude/skills/run-adc-platform/driver.mjs ready 150 || tail -20 /tmp/adc-dev.log
```

**Drive it** (screenshots land in `/tmp/adc-shots/`):

```bash
node .claude/skills/run-adc-platform/driver.mjs smoke                                  # health-check every port + key screenshots
node .claude/skills/run-adc-platform/driver.mjs shot http://localhost:3024/ home       # one screenshot
node .claude/skills/run-adc-platform/driver.mjs drive http://localhost:3024/ login-flow \
  --wait "button" --click "button" --settle 1500    # navigate + interact + screenshot
```

**Mobile** — `--mobile` (390×844 @2x, touch, mobile UA), `--device pixel7|iphone`
or `--viewport 414x896` work on `shot`/`login`/`drive`, so you can check
responsive/PWA UX without a custom CDP probe. Raise `--wait-timeout` for
federated/lazy chunks (the mobile editor's first compile exceeds the 15s default):

```bash
node .claude/skills/run-adc-platform/driver.mjs shot http://localhost:3024/ home-mobile --mobile
node .claude/skills/run-adc-platform/driver.mjs drive http://localhost:3040/ editor-mobile \
  --login admin --mobile --wait "canvas, adc-modal" --wait-timeout 30000
```

**Logged-in testing** — dev seeds two users every boot (idempotent): `admin`
(global `devadmin`) and `orgadmin` (`devorgadmin`, org `dev-org`). The driver
POSTs to `/api/auth/login` from inside the page; the `localhost` cookie then
applies across every app port. Custom users: `'username::password[::orgId]'`.

```bash
node .claude/skills/run-adc-platform/driver.mjs login admin http://localhost:3014/ identity-as-admin
node .claude/skills/run-adc-platform/driver.mjs drive http://localhost:3024/ home-authed --login orgadmin --wait "body"
```

| command | what it does |
|---|---|
| `boot-check [s]` | boot `bun src/index.ts` directly, stream service starts + ready marker + self-test + any capability/scope failure, free ports; exit 0=PASS / 1=FAIL. Self-contained. Default budget ~100s |
| `ready [s]` | block until :3000 actually serves (HTTP < 500, redirects count), not just the log marker; exit 0 when up, 1 on timeout. Default 150s |
| `smoke` | curl gateway + every app port (status < 500 = OK), screenshot home/auth/community-home; non-zero on any problem |
| `shot <url> [name]` | one-shot screenshot → `/tmp/adc-shots/<name>.png`. Accepts `--mobile`/`--device d`/`--viewport WxH` |
| `login <who> [url] [name]` | log in (`admin`\|`orgadmin`\|`'user::pass[::orgId]'`), navigate, screenshot. Accepts viewport flags. Dev only |
| `drive <url> [name]` | CDP session: `--login who`, `--wait sel`, `--wait-timeout ms`, `--click sel`, `--type "sel::text"`, `--eval expr`, `--settle ms`, `--mobile`/`--device d`/`--viewport WxH`. Ends in a screenshot + prints `document.title` and the real text of any console errors / exceptions |
| `stop` | kill kernel + all rspack dev servers, free every port in ports.csv (leaves Docker S3 on :9000/:9001) |

> To register a new port or seed another dev user: add the port to
> [docs/guides/ports.csv](docs/guides/ports.csv) (`port,app,notes` — picked up
> automatically) and the user to
> `src/services/core/IdentityManagerService/defaults/devUsers.ts`, mirroring the
> credentials in `utils/config.mjs`'s `DEV_USERS` for a login preset.

**Stop cleanly — always via the driver, never Ctrl-C or `bun run cleanup`** (see Gotchas):

```bash
node .claude/skills/run-adc-platform/driver.mjs stop
```

## Test

No standalone unit-test runner. In dev (`ENABLE_TESTS=true`, set by `bun run
dev`) several modules self-test on boot — e.g. `user-profile-mongo` logs
`PRUEBAS COMPLETADAS` after exercising the identity/permissions flow. `boot-check`
surfaces exactly those lines and exits 0/1, so it's the fastest "boots clean +
self-test passed + no capability errors" check. Static: `bun run typecheck`
(**exits 1 by baseline** from knip unused-export reporting — read the output, the
exit code is not a failure) and `bun run lint` (zero-warnings, src only).

## Gotchas

- **Never run `bun run cleanup`, or any bare `pkill -f rspack` / `pkill -f "bun src/index.ts"`, from your shell.** `pkill -f` matches by full command line, and the pattern text sits in *your own shell's argv* — so it kills the shell mid-command (empty output + exit 1, half-done cleanup). The `cleanup` script also does `pkill -9 -f "ADC-platform"`, matching any command that `cd`'d into the project path. **Use `driver.mjs stop`** — it spawns the kills as child processes with clean argv, and pkill auto-excludes itself.
- **bun orphans the kernel on exit.** It doesn't propagate SIGINT/SIGTERM to the `bun src/index.ts` child, which keeps holding :3000. Killing the `bun run dev` pid alone is not enough — always finish with `driver.mjs stop`.
- **`UIFederationService no encontrado` spam + `Failed to start server. Is port 3000 in use?`** = a **stale instance already owns :3000**. The kernel still reaches "Kernel en funcionamiento" but serves no UI. Fix: `driver.mjs stop`, then relaunch.
- **First nav to an app can be slow.** rspack dev servers compile lazily; :3000 is up long before an app's port. The driver's `--wait`/`--wait-timeout`/virtual-time-budget absorbs this — don't replace it with a fixed `sleep`. Federated chunks (e.g. mobile editor) can exceed the 15s `--wait` default; pass `--wait-timeout 30000`.
- **A bare foreground `sleep` is blocked in the sandboxed shell** — exits 1 silently, no output. Don't poll the kernel with a `sleep` loop; use `driver.mjs ready` (blocks internally) or wrap in `timeout … bash -c 'until <cond>; do sleep N; done'` (a `sleep` inside the until-loop is fine).
- **`test/home` (:3002) returns 404 at `/`** — it serves under a sub-path. `smoke` counts it OK (status < 500); not a failure.
- **Backing services are shared Docker containers**, auto-provisioned and persistent. S3 lives on `:9000/:9001` (refCount-shared) — `stop` deliberately leaves them alone.

## Troubleshooting

- **Driver/stop prints nothing and exits 1**: you ran a `pkill -f`/`bun run cleanup` whose pattern is in the shell's own command line — it killed itself. Re-run via `node .claude/skills/run-adc-platform/driver.mjs stop`.
- **Screenshot blank or shows an error**: that app's rspack server is still compiling, or the route 500s. Re-run `drive` with `--wait "<selector you expect>"` (raise `--wait-timeout` for federated chunks), check `/tmp/adc-dev.log`, and read the `✗ exception:` / `• console.error:` lines the driver prints — they carry the real failure text.
- **`EADDRINUSE` / port 3000 in use on launch**: leftover kernel from a prior run. `node .claude/skills/run-adc-platform/driver.mjs stop`, then relaunch.
- **Apps needing Mongo log connection errors**: confirm the Docker daemon is up and `adc-mongo-core` is running (`docker ps`); the kernel provisions it but can't if Docker is down.
