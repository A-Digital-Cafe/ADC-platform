# Arquitectura de Presets Multirepo

El sistema modular del kernel admite la carga dinámica de **presets** ubicados en el directorio `presets/`, fuera de la carpeta de código fuente principal `src/`. Cada subcarpeta temática dentro de `presets/` representa un preset independiente y estructurado, capaz de contener su propio conjunto de módulos (`apps/`, `services/`, `providers/`, `utilities/`).

Para garantizar un correcto desacoplamiento de responsabilidades:

- Todo componente lógico, tipo o utilidad que deba ser compartido con el resto de la plataforma o con otros servicios independientes de un preset en particular debe ubicarse en la carpeta común `src/common/`.
- El propósito principal de los presets es desacoplar lógica empresarial, servicios y aplicaciones completas en repositorios independientes de control de versiones.
- Si el directorio de un preset determinado se encuentra presente, el kernel lo integrará y habilitará su ejecución normal. En caso contrario, el sistema principal continuará operando sin interrupción ni anomalías, asegurando una alta tolerancia a fallos y modularidad real.

Las convenciones de código de los presets (tsconfig, aliases, contratos vía `@common/types`) están en [ARCHITECTURE.md](../ARCHITECTURE.md#presets-módulos-opcionales).

## Instalar presets existentes

Los presets registrados viven en `presets/.presets.txt` con el formato:

```text
<nombre>  <repo-url>  <ref>
```

- `<nombre>`: carpeta destino dentro de `presets/`
- `<repo-url>`: URL git (ssh o https)
- `<ref>`: branch, tag o commit (opcional; default = rama por defecto del remoto)

El script `scripts/sync-presets.mjs` (se ejecuta automáticamente en el `postinstall` de `npm install`):

- Clona los presets que falten.
- Omite silenciosamente los que no tengas permiso para clonar.
- NO toca los que ya estén clonados (usá `git -C presets/<nombre> pull` para actualizar).

```bash
# Ejecución manual
node scripts/sync-presets.mjs
```

## Crear y extraer un preset nuevo

### 1. Inicializar git dentro del preset

```bash
cd presets/XYZ
git init -b main
```

### 2. Archivos base obligatorios

Todo preset nuevo debe incluir los siguientes archivos en su raíz antes del primer commit:

| Archivo              | Descripción                                                        |
| -------------------- | ------------------------------------------------------------------ |
| `.gitignore`         | Excluye `node_modules/`, `dist/`, `.env`, logs, etc.               |
| `LICENSE.md`         | Licencia del código: ISC (público) o All rights reserved (privado) |
| `SECURITY.md`        | Política de seguridad — redirige al repositorio principal          |
| `CODE_OF_CONDUCT.md` | Código de conducta — redirige al repositorio principal             |

**Generación automática (requiere el repo privado `private/`):** si tenés clonado el repo interno `private/` junto al monorepo, el script `private/scripts/init-preset.mjs` copia estos archivos desde las plantillas de `private/scripts/templates/`. Es interactivo y permite elegir el tipo de preset (`public` → LICENSE ISC, `private` → All rights reserved); solo copia los archivos que no existan aún.

```bash
cd private

# Modo interactivo
bun run init-preset

# Con flags (no interactivo)
bun run init-preset --name my-preset --type public
```

**Alternativa manual (sin acceso a `private/`):** copiá los cuatro archivos desde cualquier preset existente (ej. `presets/my-account/`) y ajustá la licencia según el tipo de preset.

### 3. Primer commit

```bash
git add .
git commit -m "chore: initial XYZ preset extracted from ADC-platform"
```

### 4. Vincular al remoto creado en GitHub

```bash
git remote add origin https://github.com/A-Digital-Cafe/xyz.git
```

### 5. Push inicial

```bash
git push -u origin main
```

### 6. Registrar el preset en el monorepo

```bash
cd ../..
echo "XYZ https://github.com/A-Digital-Cafe/xyz.git main" >> presets/.presets.txt
git add presets/.presets.txt
git commit -m "chore(presets): register XYZ preset"
```
