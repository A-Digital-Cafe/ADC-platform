#!/usr/bin/env bash
# Copia el caller de CI de seguridad (adc-ci/templates/security.yml) al
# .github/workflows/ de cada repo del monorepo: root + private + adc-ci + presets/*.
# Idempotente: sobrescribe el caller (la lógica real vive en A-Digital-Cafe/adc-ci).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC="$ROOT/adc-ci/templates/security.yml"
[[ -f "$SRC" ]] || { echo "No existe $SRC"; exit 1; }

targets=("$ROOT" "$ROOT/private" "$ROOT/adc-ci")
for d in "$ROOT"/presets/*/; do [[ -d "$d/.git" ]] && targets+=("${d%/}"); done

for repo in "${targets[@]}"; do
  [[ -d "$repo/.git" ]] || { echo "skip (no git): $repo"; continue; }
  mkdir -p "$repo/.github/workflows"
  cp "$SRC" "$repo/.github/workflows/security.yml"
  echo "ok: ${repo#$ROOT/} -> .github/workflows/security.yml"
done
