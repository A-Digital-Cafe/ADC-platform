# Clientes de escritorio (`desktop/`)

Clientes que el usuario final corre en **su** máquina y que se distribuyen como
paquete público (npm), no como parte de la plataforma desplegada. Cada uno vive
en su propio repo, clonado bajo `desktop/` y **gitignored** en el monorepo — el
mismo patrón que `presets/`, `private/` y `adc-ci/`.

| Cliente | Repo | Paquete | Licencia |
| --- | --- | --- | --- |
| `adc-drive-agent` | `A-Digital-Cafe/adc-drive-agent` (público) | `@adigitalcafe/adc-drive-agent` | Apache-2.0 |

## Por qué viven fuera

1. **Licencia.** Los presets son propietarios (`All rights reserved`). Un cliente
   que la gente descarga y ejecuta necesita una licencia que se lo permita; el
   corte por repo hace evidente qué es abierto y qué no.
2. **Provenance.** `npm publish --provenance` exige que el repo sea público.
3. **Superficie.** El repo publicado no arrastra el historial del preset.

## Regla: sin dependencias

Los clientes se mantienen **con `dependencies: {}`**. Es lo que hace creíble el
"corré esto en tu máquina" y evita arrastrar auditorías de licencias de terceros.
Se apoyan sólo en APIs presentes en Node ≥ 20 **y** en Bun (`fetch`, WebCrypto,
`node:fs`, `node:stream`), para poder correrse con `npx` y con `bunx`.

## Código compartido con la plataforma

`adc-drive-agent` es el caso: sus `connectors/` (S3 SigV4, WebDAV, cifrado por
passphrase) los usa también el agente del navegador. Como `desktop/` es gitignored,
el preset **no puede** importarlos desde ahí: un clone limpio de `adc-drive` no
compilaría.

Por eso viven donde se consumen —`presets/adc-drive/apps/adc-drive/src/tunnel/connectors/`,
que es la fuente de la verdad— y el repo del cliente lleva una copia:

```bash
bash scripts/sync-drive-agent.sh   # empuja monorepo → desktop/, nunca al revés
```

Tocar un conector ⇒ correr el script, commitear en el repo del cliente y publicar
una versión nueva del paquete.

## CI de seguridad

`scripts/distribute-security-ci.sh` ya incluye `desktop/*` entre sus targets: cada
cliente recibe el mismo caller fino de [adc-ci](security-ci.md) que el resto de
los repos.

## Publicar

```bash
cd desktop/<cliente>
npm whoami                   # ¿sesión abierta? si no: npm login
npm pack --dry-run           # qué archivos entran
npm publish --dry-run        # simulacro completo
npm publish --access public  # obligatorio la 1ª vez en un paquete con scope
```

Versiones siguientes: `npm version patch|minor|major` y `npm publish`.
