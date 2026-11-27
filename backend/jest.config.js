/** @type {import('jest').Config} */
module.exports = {
    preset: 'ts-jest',
    testEnvironment: 'node',
    roots: ['<rootDir>/tests'],
    testMatch: ['**/*.test.ts'],
    // Integration suites run against the isolated catalogue_test database, migrated and seeded once.
    globalSetup: '<rootDir>/tests/globalSetup.ts',
    setupFiles: ['<rootDir>/tests/setupEnv.ts'],
    testTimeout: 30000,
    transform: { '^.+\.ts$': ['ts-jest', { isolatedModules: true }] },
};
