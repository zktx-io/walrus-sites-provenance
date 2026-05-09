/** @type {import('jest').Config} */
const config = {
  preset: 'ts-jest/presets/default-esm',
  testEnvironment: 'node',
  clearMocks: true,
  verbose: true,
  testMatch: ['**/*.test.ts'],
  testPathIgnorePatterns: ['/node_modules/', '/dist/', '/.walrus/'],
  extensionsToTreatAsEsm: ['.ts'],
  transform: {
    '^.+\\.ts$': [
      'ts-jest',
      {
        useESM: true,
        tsconfig: 'tsconfig.jest.json',
      },
    ],
  },
  moduleFileExtensions: ['ts', 'js'],
  collectCoverage: true,
  coverageReporters: ['json-summary', 'text', 'lcov'],
  collectCoverageFrom: ['./src/**/*.ts', '!./src/**/*.test.ts'],
  coverageThreshold: {
    './src/utils/suiRetry.ts': {
      statements: 80,
      branches: 60,
      functions: 100,
      lines: 80,
    },
    './src/utils/signingContext.ts': {
      statements: 85,
      branches: 80,
      functions: 75,
      lines: 85,
    },
    './src/utils/gitSigner.ts': {
      statements: 30,
      branches: 30,
      functions: 35,
      lines: 30,
    },
    './src/utils/loadConfig.ts': {
      statements: 70,
      branches: 50,
      functions: 100,
      lines: 70,
    },
    './src/utils/hexToBase36.ts': {
      statements: 100,
      branches: 100,
      functions: 100,
      lines: 100,
    },
    './src/blob/helper/quiltPatchInternalId.ts': {
      statements: 100,
      branches: 100,
      functions: 100,
      lines: 100,
    },
    './src/site/helper/registerResources.ts': {
      statements: 95,
      branches: 70,
      functions: 100,
      lines: 95,
    },
    './src/utils/concurrency.ts': {
      statements: 100,
      branches: 100,
      functions: 100,
      lines: 100,
    },
    './src/blob/registerBlobs.ts': {
      statements: 85,
      branches: 40,
      functions: 100,
      lines: 85,
    },
    './src/site/deploySite.ts': {
      statements: 45,
      branches: 20,
      functions: 60,
      lines: 45,
    },
  },
};

module.exports = config;
