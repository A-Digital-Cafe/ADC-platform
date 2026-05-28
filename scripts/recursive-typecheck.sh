#!/bin/bash

echo "🔎 Buscando tsconfig.json en repositorio..."

# Lista todos los archivos NO ignorados por git y filtra tsconfig.json
configs=$(git ls-files -co --exclude-standard | grep "tsconfig.json")

# Presets viven fuera del control de git principal (ver .gitignore /presets/)
# pero deben typecheckearse si están presentes. Buscamos sus tsconfig.json
# explícitamente, ignorando node_modules.
if [[ -d "presets" ]]; then
  preset_configs=$(find presets -name tsconfig.json -not -path '*/node_modules/*' 2>/dev/null)
  if [[ -n "$preset_configs" ]]; then
    configs=$(printf '%s\n%s\n' "$configs" "$preset_configs" | sort -u)
  fi
fi

if [[ -z "$configs" ]]; then
  echo "❌ No se encontraron tsconfig.json"
  exit 1
fi

echo "⚙ Ejecutando typecheck por proyecto..."

fail=0

for cfg in $configs; do
  dir=$(dirname "$cfg")
  echo "➡ tsgo -p $cfg"
  
  npx tsgo -p "$cfg" --noEmit
  if [[ $? -ne 0 ]]; then
    echo "❌ Error en $cfg" >&2
    fail=1
  else
    echo "✅ $cfg OK"
  fi

  echo
done

if [[ $fail -ne 0 ]]; then
  echo "❌ Al menos un proyecto falló"
  exit 1
fi

echo "🎉 Todos los proyectos pasaron el typecheck"
exit 0
