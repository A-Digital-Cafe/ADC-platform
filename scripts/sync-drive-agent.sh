#!/usr/bin/env bash
# Sincroniza los conectores compartidos del monorepo hacia el repo del agente CLI
# de Drive (`desktop/adc-drive-agent`, gitignored, se publica en npm aparte).
#
# La fuente de la verdad es `apps/adc-drive/src/tunnel/connectors/` del preset:
# los conectores son código de la app (los usa el agente del navegador), y el CLI
# lleva una copia. Este script empuja la copia; nunca al revés.
#
# Idempotente. Corré esto y publicá una versión nueva del paquete cada vez que
# toques un conector.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC="$ROOT/presets/adc-drive/apps/adc-drive/src/tunnel/connectors"
DST="$ROOT/desktop/adc-drive-agent/connectors"

[[ -d "$SRC" ]] || { echo "No existe $SRC (¿está clonado el preset adc-drive?)"; exit 1; }
[[ -d "$DST" ]] || { echo "No existe $DST (¿está clonado desktop/adc-drive-agent?)"; exit 1; }

changed=0
for f in "$SRC"/*.mjs; do
  name="$(basename "$f")"
  if ! cmp -s "$f" "$DST/$name"; then
    cp "$f" "$DST/$name"
    echo "actualizado: connectors/$name"
    changed=1
  fi
done

if [[ "$changed" -eq 0 ]]; then
  echo "conectores ya sincronizados."
else
  echo
  echo "Hay cambios: commiteá en desktop/adc-drive-agent y publicá una versión nueva."
fi
