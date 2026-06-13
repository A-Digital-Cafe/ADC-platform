#!/bin/bash

# Script para limpiar procesos zombies y procesos de Stencil/Node que quedaron ejecutándose

echo "🧹 Limpiando procesos relacionados con ADC Platform..."

# Matar procesos de Stencil
echo "Buscando procesos de Stencil..."
pkill -9 -f "stencil build --watch" 2>/dev/null && echo "✓ Procesos de 'stencil build --watch' terminados" || echo "✗ No se encontraron procesos de 'stencil build --watch'"

# Matar workers de Stencil
echo "Buscando workers de Stencil..."
pkill -9 -f "node_modules/@stencil/core/sys/node/worker.js" 2>/dev/null && echo "✓ Workers de Stencil terminados" || echo "✗ No se encontraron workers de Stencil"

# Matar procesos de Vite en watch mode
echo "Buscando procesos de Vite..."
pkill -9 -f "vite build --watch" 2>/dev/null && echo "✓ Procesos de 'vite build --watch' terminados" || echo "✗ No se encontraron procesos de 'vite build --watch'"

# Matar procesos de Astro en watch mode
echo "Buscando procesos de Astro..."
pkill -9 -f "astro build --watch" 2>/dev/null && echo "✓ Procesos de 'astro build --watch' terminados" || echo "✗ No se encontraron procesos de 'astro build --watch'"

# Matar workers de Module Federation DTS Plugin
echo "Buscando workers de Module Federation..."
pkill -9 -f "fork-dev-worker.js" 2>/dev/null && echo "✓ Workers de Module Federation terminados" || echo "✗ No se encontraron workers de Module Federation"
pkill -9 -f "start-broker.js" 2>/dev/null && echo "✓ Brokers de Module Federation terminados" || echo "✗ No se encontraron brokers de Module Federation"

# Matar procesos relacionados con ADC-platform específicamente
echo "Buscando procesos de ADC-platform..."
pkill -9 -f "ADC-platform" 2>/dev/null && echo "✓ Procesos de ADC-platform terminados" || echo "✗ No se encontraron procesos de ADC-platform"

# Matar el kernel ADC (bun src/index.ts): bun no propaga el Ctrl-C al hijo, que
# queda huérfano reteniendo el puerto 3000. `pkill -f "ADC-platform"` no lo
# alcanza porque "ADC-platform" solo está en el cwd, no en la línea de comando.
echo "Buscando kernel ADC..."
pkill -9 -f "bun src/index.ts" 2>/dev/null && echo "✓ Kernel ADC terminado" || echo "✗ No se encontró kernel ADC"

# Red de seguridad: liberar los puertos de dev por si algo siguió escuchando
# (3000 API + subdominios UI vía devPort).
echo "Liberando puertos de dev..."
for port in 3000 3012 3016 3020 3032; do
    fuser -k -9 "${port}/tcp" 2>/dev/null && echo "✓ Puerto ${port} liberado" || true
done

# Matar procesos de Rspack (webpack-dev-server / rspack-dev-server)
echo "Buscando procesos de Rspack..."
pkill -9 -f "rspack" 2>/dev/null && echo "✓ Procesos de Rspack terminados" || echo "✗ No se encontraron procesos de Rspack"
readonly defunct_process="'\[.*\] <defunct>'"

# Limpiar procesos zombies (intentar que el padre los limpie primero)
echo "Limpiando procesos zombies..."
zombie_count=$(ps aux | grep -E $defunct_process | grep -v grep | wc -l)
if [[ $zombie_count -gt 0 ]]; then
    echo "⚠ Se encontraron $zombie_count procesos zombies"
    # Los procesos zombies no se pueden matar directamente, pero podemos matar sus padres
    # y esperar a que el sistema los limpie
    ps aux | grep -E $defunct_process | grep -v grep | awk '{print $2}' | while read zpid; do
        ppid=$(ps -o ppid= -p $zpid 2>/dev/null | tr -d ' ')
        if [[ -n "$ppid" ]] && [[ "$ppid" != "1" ]]; then
            echo "  Matando proceso padre $ppid del zombie $zpid"
            kill -9 $ppid 2>/dev/null || true
        fi
    done
    sleep 2
    zombie_count=$(ps aux | grep -E $defunct_process | grep -v grep | wc -l)
    if [[ $zombie_count -gt 0 ]]; then
        echo "⚠ Todavía quedan $zombie_count procesos zombies (se limpiarán automáticamente)"
    else
        echo "✓ Procesos zombies limpiados"
    fi
else
    echo "✓ No se encontraron procesos zombies"
fi

echo ""
echo "✅ Limpieza completada"
echo ""
echo "Conteo de procesos Node activos:"
node_count=$(ps aux | grep -E 'node|tsx' | grep -v grep | grep -v "cleanup-processes" | wc -l)
zombie_final=$(ps aux | grep -E $defunct_process | grep -v grep | wc -l)
echo "  - Procesos Node activos: $node_count"
echo "  - Procesos zombies restantes: $zombie_final"

if [[ $node_count -gt 10 ]]; then
    echo ""
    echo "⚠ Advertencia: Hay más de 10 procesos Node activos"
    echo "  Si no deberían estar ejecutándose, considera reiniciar el sistema"
fi

