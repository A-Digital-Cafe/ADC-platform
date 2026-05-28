#!/usr/bin/env bash
# scripts/sync-presets.sh
# Clona cada preset listado en presets/.presets.txt que:
#   - todavía no exista en disco
#   - sea accesible con las credenciales actuales (ls-remote OK)
# Nunca falla el proceso completo: errores por preset solo se reportan.

set -u
PRESETS_FILE="presets/.presets.txt"

if [[ ! -f "$PRESETS_FILE" ]]; then
	# No hay archivo de presets; no es un error.
	exit 0
fi

mkdir -p presets

ok=0
skipped_exists=0
skipped_noaccess=0
failed=0

while IFS= read -r raw_line || [[ -n "$raw_line" ]]; do
	# Quitar comentarios y trim
	line="${raw_line%%#*}"
	line="$(echo "$line" | xargs)"
	[[ -z "$line" ]] && continue

	# shellcheck disable=SC2206
	parts=($line)
	name="${parts[0]:-}"
	repo="${parts[1]:-}"
	ref="${parts[2]:-}"

	if [[ -z "$name" || -z "$repo" ]]; then
		echo "  ⚠ línea inválida en $PRESETS_FILE: $raw_line" >&2
		continue
	fi

	dir="presets/$name"

	if [[ -d "$dir/.git" || -d "$dir" ]]; then
		echo "  ✓ $name ya está presente (skip)"
		skipped_exists=$((skipped_exists + 1))
		continue
	fi

	# Verificar acceso sin clonar
	if ! GIT_TERMINAL_PROMPT=0 git ls-remote "$repo" >/dev/null 2>&1; then
		echo "  ⤬ $name: sin acceso o repo inaccesible (skip)"
		skipped_noaccess=$((skipped_noaccess + 1))
		continue
	fi

	echo "  ↓ clonando $name desde $repo${ref:+ @ $ref}"
	if GIT_TERMINAL_PROMPT=0 git clone --quiet "$repo" "$dir" 2>/dev/null; then
		if [[ -n "$ref" ]]; then
			git -C "$dir" checkout --quiet "$ref" 2>/dev/null || \
				echo "    ⚠ no se pudo hacer checkout de $ref en $name" >&2
		fi
		ok=$((ok + 1))
	else
		echo "    ✗ clone falló para $name" >&2
		rm -rf "$dir"
		failed=$((failed + 1))
	fi
done < "$PRESETS_FILE"

echo "Presets: $ok clonados, $skipped_exists existentes, $skipped_noaccess sin acceso, $failed fallidos."
exit 0
