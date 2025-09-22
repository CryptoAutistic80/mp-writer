module.exports = {
  root: true,
  ignorePatterns: [
    'dist',
    'node_modules',
    'tmp',
    'frontend-e2e',
    'backend-api-e2e',
    'nest-modules'
  ],
  overrides: [
    {
      files: ['backend-api/**/*.ts'],
      parser: '@typescript-eslint/parser',
      parserOptions: {
        project: ['backend-api/tsconfig.eslint.json'],
        tsconfigRootDir: __dirname,
        sourceType: 'module'
      },
      plugins: ['@typescript-eslint'],
      extends: [
        'eslint:recommended',
        'plugin:@typescript-eslint/recommended'
      ],
      rules: {
        '@typescript-eslint/explicit-function-return-type': 'off',
        '@typescript-eslint/no-explicit-any': 'off',
        '@typescript-eslint/no-unused-vars': [
          'error',
          {
            argsIgnorePattern: '^_',
            caughtErrorsIgnorePattern: '^_',
            ignoreRestSiblings: true,
            varsIgnorePattern: '^_'
          }
        ]
      }
    }
  ]
};
