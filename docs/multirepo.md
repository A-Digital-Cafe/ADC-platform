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

git remote add origin https://github.com/A-Digital-Cafe/adc-preset-xyz.git

# (o https://github.com/A-Digital-Cafe/adc-preset-xyz.git si no usás SSH)

# 5. Push inicial

git push -u origin main

# 6. Volver al monorepo y registrar el preset en presets/.presets.txt

cd ../..
echo "XYZ https://github.com/A-Digital-Cafe/adc-preset-xyz.git main" >> presets/.presets.txt
git add presets/.presets.txt
git commit -m "chore(presets): register XYZ preset"
