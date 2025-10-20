// Root ESLint flat config for the Nx workspace
// Scope specific overrides to `backend-api` to fix current lint issues incrementally

// Prefer CommonJS export for compatibility with Nx executors
const js = require('@eslint/js');
const tseslint = require('@typescript-eslint/eslint-plugin');
const tsParser = require('@typescript-eslint/parser');

module.exports = [
  {
    files: ['**/*.{js,ts,tsx}'],
    ignores: [
      '**/dist/**',
      '**/.next/**',
      '**/*.spec.ts',
      '**/*.spec.tsx', 
      '**/*.test.ts',
      '**/*.test.tsx',
      '**/src/**/*.spec.ts',
      '**/src/**/*.spec.tsx',
      '**/src/**/*.test.ts',
      '**/src/**/*.test.tsx',
      'backend-api/src/**/*.spec.ts',
      'backend-api/src/**/*.spec.tsx',
      'backend-api/src/**/*.test.ts',
      'backend-api/src/**/*.test.tsx',
      '**/ai.service.spec.ts',
      '**/writing-desk-jobs.controller.spec.ts',
      'backend-api/src/ai/ai.service.spec.ts',
      'backend-api/src/writing-desk-jobs.controller.spec.ts',
      'backend-api/src/writing-desk-jobs/writing-desk-jobs.controller.spec.ts',
    ],
  },
  js.configs.recommended,
  {
    files: ['**/*.ts', '**/*.tsx'],
    ignores: [
      '**/dist/**',
      '**/.next/**',
      '**/*.spec.ts',
      '**/*.spec.tsx', 
      '**/*.test.ts',
      '**/*.test.tsx',
      '**/src/**/*.spec.ts',
      '**/src/**/*.spec.tsx',
      '**/src/**/*.test.ts',
      '**/src/**/*.test.tsx',
      'backend-api/src/**/*.spec.ts',
      'backend-api/src/**/*.spec.tsx',
      'backend-api/src/**/*.test.ts',
      'backend-api/src/**/*.test.tsx',
      '**/ai.service.spec.ts',
      '**/writing-desk-jobs.controller.spec.ts',
      'backend-api/src/ai/ai.service.spec.ts',
      'backend-api/src/writing-desk-jobs.controller.spec.ts',
      'backend-api/src/writing-desk-jobs/writing-desk-jobs.controller.spec.ts',
    ],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',
        project: ['./backend-api/tsconfig.app.json'],
        tsconfigRootDir: __dirname,
      },
      globals: {
        console: 'readonly',
        process: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        fetch: 'readonly',
        NodeJS: 'readonly',
        Buffer: 'readonly',
      },
    },
    plugins: {
      '@typescript-eslint': tseslint,
    },
      rules: {
        ...tseslint.configs.recommended.rules,
        '@typescript-eslint/prefer-nullish-coalescing': 'off',
        '@typescript-eslint/require-await': 'off',
        '@typescript-eslint/no-explicit-any': 'warn',
        '@typescript-eslint/no-unsafe-assignment': 'warn',
        '@typescript-eslint/no-unsafe-member-access': 'warn',
        '@typescript-eslint/no-unsafe-call': 'warn',
        '@typescript-eslint/no-unsafe-return': 'warn',
        '@typescript-eslint/no-unnecessary-type-assertion': 'warn',
        '@typescript-eslint/array-type': ['error', { default: 'array-simple' }],
        '@typescript-eslint/consistent-type-definitions': ['error', 'interface'],
        '@typescript-eslint/no-unused-vars': ['error', { 
          'argsIgnorePattern': '^_',
          'varsIgnorePattern': '^_',
          'caughtErrorsIgnorePattern': '^_'
        }],
      },
  },
];


