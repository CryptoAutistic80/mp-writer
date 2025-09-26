/** @type {import('jest').Config} */
const config = {
  displayName: 'backend-api',
  testEnvironment: 'node',
  transform: {
    '^.+\\.[tj]s$': [
      '@swc/jest',
      {
        swcrc: false,
        jsc: {
          target: 'es2021',
          parser: {
            syntax: 'typescript',
            tsx: false,
            decorators: true,
          },
        },
        module: {
          type: 'commonjs',
        },
      },
    ],
  },
  moduleFileExtensions: ['ts', 'js', 'json'],
  testMatch: ['<rootDir>/**/*.spec.ts'],
  moduleDirectories: ['node_modules', '<rootDir>/src', '<rootDir>'],
  coverageDirectory: '<rootDir>/../coverage/backend-api',
  collectCoverageFrom: ['<rootDir>/src/**/*.{ts,js}', '!<rootDir>/src/**/*.d.ts'],
};

module.exports = config;
