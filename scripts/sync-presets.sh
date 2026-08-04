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

# Mismas validaciones que scripts/sync-presets.mjs (ver el comentario largo de ahí):
# el nombre construye la ruta de destino (y un `rm -rf`), y la URL entra como argv de
# git, donde un valor que empieza con `-` se interpreta como opción (`--upload-pack=<cmd>`
# ejecuta <cmd>) y un `ext::<cmd>` es un helper de transporte arbitrario.
NAME_RE='^[A-Za-z0-9][A-Za-z0-9._-]*$'
REPO_RE='^(https://|ssh://|git@[^[:space:]:/]+:)[^[:space:]]+$'
REF_RE='^[A-Za-z0-9][A-Za-z0-9._/-]*$'

# GIT_ALLOW_PROTOCOL manda sobre cualquier `protocol.<x>.allow` del gitconfig del usuario.
export GIT_ALLOW_PROTOCOL="https:ssh"
export GIT_TERMINAL_PROMPT=0

ok=0
skipped_exists=0
skipped_noaccess=0
failed=0
invalid=0

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
		invalid=$((invalid + 1))
		continue
	fi

	if [[ ! "$name" =~ $NAME_RE || "$name" == *".."* ]]; then
		echo "  ✗ nombre de preset inválido (se omite): $name" >&2
		invalid=$((invalid + 1))
		continue
	fi

	if [[ ! "$repo" =~ $REPO_RE || "$repo" == *".."* ]]; then
		echo "  ✗ $name: URL de repo rechazada (sólo https://, ssh:// o git@host:path)" >&2
		invalid=$((invalid + 1))
		continue
	fi

	if [[ -n "$ref" && ( ! "$ref" =~ $REF_RE || "$ref" == *".."* ) ]]; then
		echo "  ✗ $name: ref inválida (se omite el preset)" >&2
		invalid=$((invalid + 1))
		continue
	fi

	dir="presets/$name"

	if [[ -d "$dir/.git" || -d "$dir" ]]; then
		echo "  ✓ $name ya está presente (skip)"
		skipped_exists=$((skipped_exists + 1))
		continue
	fi

	# Verificar acceso sin clonar. El `--` es end-of-options: sin él, un repo que empieza
	# con `-` lo consume git como flag (`git checkout <ref> --` es la forma correcta ahí:
	# `--end-of-options` no funciona con checkout).
	if ! git ls-remote -- "$repo" >/dev/null 2>&1; then
		echo "  ⤬ $name: sin acceso o repo inaccesible (skip)"
		skipped_noaccess=$((skipped_noaccess + 1))
		continue
	fi

	echo "  ↓ clonando $name${ref:+ @ $ref}"
	if git clone --quiet -- "$repo" "$dir" 2>/dev/null; then
		if [[ -n "$ref" ]]; then
			git -C "$dir" checkout --quiet "$ref" -- 2>/dev/null || \
				echo "    ⚠ no se pudo hacer checkout de $ref en $name" >&2
		fi
		# Instalar dependencias de cada módulo dentro del preset (services/, apps/, etc.)
		# Cada módulo tiene su propio package.json; se instala en su directorio para no
		# afectar el lockfile raíz.
		while IFS= read -r pkg; do
			module_dir="$(dirname "$pkg")"
			echo "    → bun install en $module_dir"
			(cd "$module_dir" && bun install --ignore-scripts) 2>/dev/null || \
				echo "    ⚠ bun install falló en $module_dir (no crítico)" >&2
		done < <(find "$dir" -name "package.json" -not -path "*/node_modules/*")
		ok=$((ok + 1))
	else
		echo "    ✗ clone falló para $name" >&2
		rm -rf "$dir"
		failed=$((failed + 1))
	fi
done < "$PRESETS_FILE"

msg="Presets: $ok clonados, $skipped_exists existentes, $skipped_noaccess sin acceso, $failed fallidos"
[[ "$invalid" -gt 0 ]] && msg="$msg, $invalid inválidos"
echo "$msg."
exit 0
