// eslint.config.js
import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default [
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    // `dist-ui/` va acá porque la estrategia astro compila DENTRO del directorio de la app
    // (las de rspack escriben en `temp/ui-builds`, fuera de `src`): sin esto, lintea el bundle.
    ignores: [
      '**/*.d.ts',
      '**/utils/react-jsx.ts',
      'src/common/docker/adc-haraka-core/**',
      '**/dist-ui/**',
      '**/dist/**',
      // Generado por scripts/build-vendor-esm.mjs (React auto-hospedado): es un bundle de terceros.
      'src/common/public/vendor/**',
    ],
  },
  {
    // Globals de navegador para el código de apps. Sólo importan en JS plano: en `.ts`/`.tsx`
    // typescript-eslint apaga `no-undef` porque TS ya lo verifica, así que sin este bloque los
    // únicos que fallaban eran los `.mjs` de los conectores del túnel del Drive.
    files: [
      'src/apps/*/*/src/**/*.{js,mjs,jsx,tsx}',
      'presets/*/apps/*/src/**/*.{js,mjs,jsx,tsx}',
    ],
    languageOptions: {
      parser: tseslint.parser,
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: {
        window: 'readonly',
        document: 'readonly',
        localStorage: 'readonly',
        sessionStorage: 'readonly',
        navigator: 'readonly',
        fetch: 'readonly',
        console: 'readonly',
        crypto: 'readonly',
        URL: 'readonly',
        URLSearchParams: 'readonly',
        TextEncoder: 'readonly',
        TextDecoder: 'readonly',
        btoa: 'readonly',
        atob: 'readonly',
        Blob: 'readonly',
        File: 'readonly',
        FormData: 'readonly',
        AbortController: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
      },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
      'no-console': 'off',
      '@typescript-eslint/no-require-imports': 'error', // keep forbid require
    },
  },
  {
    languageOptions: {
      parser: tseslint.parser,
      ecmaVersion: 'latest',
      sourceType: 'module',
    },
    linterOptions: {
      reportUnusedDisableDirectives: true,
    },
    files: ['**/*.ts', '**/*.tsx'],
    plugins: {
      '@typescript-eslint': tseslint.plugin,
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': 'off',
    },
  },
  {
    // El tsconfig de una app no puede separar sus dos runtimes: cubre el `index.ts` que carga el
    // kernel (bun) y el `src/**` que empaqueta el bundler (navegador) con un único `types`, que por
    // eso es la intersección (`node`). ESLint sí puede, porque filtra por ruta: acá se prohíbe en la
    // mitad de navegador lo que el tsconfig no puede dejar de tipar para la mitad de servidor.
    files: ['src/apps/*/*/src/**/*.{ts,tsx}', 'presets/*/apps/*/src/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-globals': [
        'error',
        { name: 'Bun', message: 'Bun sólo existe en el kernel; este archivo corre en el navegador.' },
        { name: 'process', message: 'process no existe en el navegador. Para configuración pública usá publicEnv().' },
      ],
      // La regla de globals no mira los imports: sin esto, `import { Buffer } from "node:buffer"` pasa.
      'no-restricted-imports': [
        'error',
        { patterns: [{ group: ['node:*'], message: 'Los módulos de node no llegan al navegador.' }] },
      ],
    },
  },
];
