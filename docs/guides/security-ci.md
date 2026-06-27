# CI de seguridad centralizada (adc-ci)

Análisis estático compartido por **todos** los repos de `A-Digital-Cafe` (root +
presets). La lógica vive una sola vez en el repo público
**[`A-Digital-Cafe/adc-ci`](https://github.com/A-Digital-Cafe/adc-ci)** como
*reusable workflow*; cada repo solo lleva un caller fino en
`.github/workflows/security.yml`.

> `adc-ci/` se clona aparte y está **gitignored** en root (como `presets/` y
> `private/`). No se versiona desde el monorepo.

## Herramientas

| Tool | Rol | Modo |
| --- | --- | --- |
| Semgrep (`--config auto`) | SAST | PR aprobado · push a main · semanal |
| OSV-Scanner | Vulns de deps + licencias (alt. libre a FOSSA) | PR aprobado · push a main · semanal |
| Trivy (`config`) | Misconfig Docker (solo si el repo tiene Dockerfile/compose) | PR aprobado · push a main · semanal |
| OSSF Scorecard | Prácticas de seguridad del repo | **solo semanal** |

## Triggers

- **PR aprobado** (`pull_request_review` submitted = approved) → gate (Semgrep +
  OSV + Trivy). Corre en contexto del repo base ⇒ **seguro ante PRs de la
  comunidad/forks** (el PR no puede alterar el workflow, no se ejecuta su código:
  todo es escaneo estático, sin `install`/`build`). El modo PR no usa secrets.
- **Push a main** (directo o merge) → mismo gate Semgrep + OSV + Trivy, **salvo
  que el commit ya se haya escaneado en su PR** (dedup por SHA). Tus push directos
  siempre se analizan; un PR de la comunidad no se escanea dos veces.
- **Semanal** (lunes 06:00 UTC) → suite completa **+ Scorecard**, report-only + email.

Resultados en el **Job Summary** del run; en PR cada job es un **check**.

### Dedup de escaneos

Cada scan limpio guarda un marcador en **Actions cache** (`scanned-<sha>`; no
requiere PAT). En push a main, si el commit es un *merge commit* cuyo 2º padre
(head del PR) ya está marcado, se omite. **Limitación:** solo aplica a merge
commits; *squash*/*rebase* generan SHAs nuevos y se re-escanean (*fail-open*:
ante la duda, escanea).

## Por qué `adc-ci` es público

Un reusable workflow en repo **privado** no puede ser invocado por repos
**públicos** (los presets públicos romperían). El archivo no contiene secrets:
se inyectan en runtime (el caller pasa solo los 5 secrets SMTP en el job weekly).

## Setup (una sola vez)

1. Crear `A-Digital-Cafe/adc-ci` **público** y `git push`.
2. `adc-ci` → Settings → Actions → General → *Access* → "Accessible from
   repositories in the A-Digital-Cafe organization".
3. Secrets de **org** para el email semanal (opcionales): `SMTP_SERVER`,
   `SMTP_PORT`, `SMTP_USERNAME`, `SMTP_PASSWORD`, `SECURITY_REPORT_TO`.
4. Distribuir el caller a cada repo: `bash scripts/distribute-security-ci.sh`
   (idempotente; corré tras clonar un preset nuevo).

## SonarQube

Ya integrado desde su web (postea checks en PR por su GitHub App). **No** se
agrega `sonar-scanner` aquí para no duplicar; esta suite es complementaria.
