module.exports = {
  root: true,
  extends: ['next/core-web-vitals', 'plugin:@typescript-eslint/recommended'],
  parser: '@typescript-eslint/parser',
  parserOptions: {
    project: './tsconfig.eslint.json',
    tsconfigRootDir: __dirname
  },
  plugins: ['@typescript-eslint'],
  overrides: [
    {
      files: ['next.config.js'],
      env: {
        node: true
      },
      rules: {
        '@typescript-eslint/no-require-imports': 'off'
      }
    }
  ],
  ignorePatterns: ['!**/*'],
  rules: {
    '@next/next/no-html-link-for-pages': 'off',
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
};
