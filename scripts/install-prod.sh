#!/bin/bash
# Instalación de dependencias para producción: reproduce EXACTAMENTE el árbol
# que describe bun.lock y nunca lo reescribe. Cualquier desajuste entre los
# package.json y el lock es un error, no algo a resolver en el server.
#
#   bash scripts/install-prod.sh [args extra para bun install]

set -euo pipefail

cd "$(dirname "$0")/.."

if ! command -v bun >/dev/null 2>&1; then
	echo "❌ bun no está instalado (el runtime del proyecto es bun, no npm)"
	exit 1
fi

if [[ ! -f bun.lock ]]; then
	echo "❌ Falta bun.lock: no hay árbol reproducible que instalar"
	exit 1
fi

# Testigo del lock: --frozen-lockfile ya aborta si haría falta reescribirlo,
# pero el postinstall (sync-presets) puede traer workspaces nuevos y moverlo.
lock_before=$(sha256sum bun.lock | cut -d' ' -f1)

echo "📦 bun install --frozen-lockfile"
bun install --frozen-lockfile "$@"

lock_after=$(sha256sum bun.lock | cut -d' ' -f1)
if [[ "$lock_before" != "$lock_after" ]]; then
	echo "❌ bun.lock cambió durante la instalación (¿presets nuevos sin lockear?)."
	echo "   Revertí el archivo y regenerá el lock en desarrollo, no en producción:"
	echo "     git checkout -- bun.lock"
	exit 1
fi

echo "✅ Dependencias instaladas sin tocar bun.lock"
