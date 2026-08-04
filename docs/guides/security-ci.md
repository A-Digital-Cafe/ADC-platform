# CI de seguridad centralizada (adc-ci)

Análisis estático compartido por **todos** los repos de `A-Digital-Cafe` (root +
presets). La lógica vive una sola vez en el repo público
**[`A-Digital-Cafe/adc-ci`](https://github.com/A-Digital-Cafe/adc-ci)** como
*reusable workflow*; cada repo solo lleva un caller fino en
`.github/workflows/security.yml`.

> `adc-ci/` se clona aparte y está **gitignored** en root (como `presets/` y el
> repo interno). No se versiona desde el monorepo.

## Herramientas

| Tool | Rol | Modo |
| --- | --- | --- |
| Semgrep (`--config auto`) | SAST | PR aprobado · periódico · manual |
| OSV-Scanner | Vulns de deps + licencias (alt. libre a FOSSA) | PR aprobado · periódico · manual |
| Trivy (`config`) | Misconfig Docker (solo si el repo tiene Dockerfile/compose) | PR aprobado · periódico · manual |
| OSSF Scorecard | Prácticas de seguridad del repo | **solo periódico/manual** |

## Triggers

Son exactamente tres — los del `on:` de cada caller
(`.github/workflows/security.yml`, idéntico en root y en los presets):

- **PR aprobado** (`pull_request_review` con `types: [submitted]`) → gate (Semgrep +
  OSV + Trivy). Corre en contexto del repo base ⇒ **seguro ante PRs de la
  comunidad/forks** (el PR no puede alterar el workflow, no se ejecuta su código:
  todo es escaneo estático, sin `install`/`build`). El modo PR no usa secrets.
- **Periódico** (`schedule`, cron `0 6 */4 * *` = cada 4 días a las 06:00 UTC) →
  suite completa **+ Scorecard**, report-only. El mail sale sólo si hay hallazgos o si
  algún job falló/se canceló, y únicamente con `SMTP_SERVER` definido.
- **Manual** (`workflow_dispatch`) → la misma suite report-only on-demand, con dos
  inputs: `only` (`all` | `scorecard` | `semgrep` | `osv` | `trivy`) y `email`.

> **No hay trigger de `push`**, ni a `main` ni a ninguna rama: `main` queda cubierta
> por el PR aprobado más el escaneo periódico. Si alguna vez se agrega, tener en
> cuenta que un `push` de un PR de la comunidad correría en contexto del repo base.

Resultados en el **Job Summary** del run; en PR cada job es un **check**.

## Por qué `adc-ci` es público

Un reusable workflow en repo **privado** no puede ser invocado por repos
**públicos** (los presets públicos romperían). El archivo no contiene secrets: se
inyectan en runtime, y el caller pasa los SMTP **sólo** en los jobs `scheduled` y
`manual` (no usa `secrets: inherit`); el job de PR no recibe ninguno.

## Setup (una sola vez)

1. Crear `A-Digital-Cafe/adc-ci` **público** y `git push`.
2. `adc-ci` → Settings → Actions → General → *Access* → "Accessible from
   repositories in the A-Digital-Cafe organization".
3. Secrets de **org** para el email de reporte (opcionales): `SMTP_SERVER`,
   `SMTP_PORT`, `SMTP_USERNAME`, `SMTP_PASSWORD`, `SECURITY_REPORT_TO`.
4. Distribuir el caller a cada repo: `bash scripts/distribute-security-ci.sh`
   (idempotente; corré tras clonar un preset nuevo).

## SonarQube

Ya integrado desde su web (postea checks en PR por su GitHub App). **No** se
agrega `sonar-scanner` aquí para no duplicar; esta suite es complementaria.
