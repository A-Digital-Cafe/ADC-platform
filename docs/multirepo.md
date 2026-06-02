# Arquitectura de Presets Multirepo

El sistema modular del kernel admite la carga dinámica de **presets** ubicados en el directorio [presets](presets), fuera de la carpeta de código fuente principal [src](src). Cada subcarpeta temática dentro de [presets](presets) representa un preset independiente y estructurado, capaz de contener su propio conjunto de módulos (tales como aplicaciones, servicios, proveedores u otros componentes).

Para garantizar un correcto desacoplamiento de responsabilidades:

- Todo componente lógico, tipo o utilidad que deba ser compartido con el resto de la plataforma o con otros servicios independientes de un preset en particular debe ubicarse en la carpeta común [src/common](src/common).
- El propósito principal de los presets es desacoplar lógica empresarial, servicios y aplicaciones completas en repositorios independientes de control de versiones.
- Si el directorio de un preset determinado se encuentra presente, el kernel lo integrará y habilitará su ejecución normal. En caso contrario, el sistema principal continuará operando sin interrupción ni anomalías, asegurando una alta tolerancia a fallos y modularidad real.

A continuación se detallan las instrucciones para inicializar, aislar y registrar estos presets en proyectos independientes:

## Guía de Configuración y Extracción de Presets

# 1. Inicializar git dentro del preset (ya existe en presets/XYZ/ por el git mv)

cd presets/XYZ
git init -b main

# 2. (Opcional) un .gitignore mínimo del preset

cat > .gitignore <<'EOF'
node_modules/
dist/
\*.log
.env
EOF

# 3. Primer commit

git add .
git commit -m "chore: initial XYZ preset extracted from ADC-platform"

# 4. Vincular al remoto que creaste en GitHub

git remote add origin https://github.com/A-Digital-Cafe/xyz.git

# 5. Push inicial

git push -u origin main

# 6. Volver al monorepo y registrar el preset en presets/.presets.txt

cd ../..
echo "XYZ https://github.com/A-Digital-Cafe/xyz.git main" >> presets/.presets.txt
git add presets/.presets.txt
git commit -m "chore(presets): register XYZ preset"
