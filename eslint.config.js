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
    ],
  },
  {
    files: [
      'src/apps/**/web-*/**/*.{js,jsx,tsx}'
    ],
    languageOptions: {
      parser: tseslint.parser,
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: {
        window: 'readonly',
        document: 'readonly',
        localStorage: 'readonly',
        navigator: 'readonly',
        fetch: 'readonly',
        console: 'readonly',
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
];
