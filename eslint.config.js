const eslintPluginPrettier = require('eslint-plugin-prettier');
const eslintPluginJest = require('eslint-plugin-jest');
const eslintPluginGithub = require('eslint-plugin-github');
const eslintPluginJsonc = require('eslint-plugin-jsonc');
const tseslint = require('@typescript-eslint/eslint-plugin');
const importPlugin = require('eslint-plugin-import');

module.exports = [
  {
    ignores: ['dist/**', 'node_modules/**'],
  },
  {
    files: ['src/**/*.{ts,js}'],
    languageOptions: {
      parser: require('@typescript-eslint/parser'),
    },
    plugins: {
      prettier: eslintPluginPrettier,
      jest: eslintPluginJest,
      github: eslintPluginGithub,
      jsonc: eslintPluginJsonc,
      '@typescript-eslint': tseslint,
      import: importPlugin,
    },
    rules: {
      'prettier/prettier': 'error',
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: '@mysten/sui/jsonRpc',
              message:
                'Sui JSON-RPC is retired for deployment code. Use the local gRPC/Core wrapper in src/utils/suiClient.ts.',
            },
            {
              name: '@mysten/sui/client',
              importNames: ['SuiClient'],
              message:
                'Import SuiClient from src/utils/suiClient.ts so deployment code stays on the official gRPC/Core client.',
            },
          ],
          patterns: [
            {
              group: ['@mysten/sui/jsonRpc/*'],
              message:
                'Sui JSON-RPC is retired for deployment code. Use the local gRPC/Core wrapper in src/utils/suiClient.ts.',
            },
          ],
        },
      ],
      'import/order': [
        'warn',
        {
          groups: ['builtin', 'external', 'internal', 'parent', 'sibling', 'index'],
          'newlines-between': 'always',
          alphabetize: {
            order: 'asc',
            caseInsensitive: true,
          },
        },
      ],
    },
  },
  {
    files: ['src/**/*.{ts,js}'],
    ignores: ['src/utils/suiRetry.ts', 'src/utils/gitSigner.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: "CallExpression[callee.property.name='simulateTransaction']",
          message: 'Deployment transactions must use runTx instead of direct simulateTransaction calls.',
        },
        {
          selector: "CallExpression[callee.property.name='executeTransaction']",
          message: 'Deployment transactions must use runTx instead of direct executeTransaction calls.',
        },
        {
          selector: "CallExpression[callee.property.name='waitForTransaction']",
          message: 'Deployment transactions must use runTx instead of direct waitForTransaction calls.',
        },
        {
          selector: "CallExpression[callee.property.name='setGasBudget']",
          message: 'Deployment transactions must use runTx instead of setting gas budgets directly.',
        },
        {
          selector:
            "CallExpression[callee.property.name=/^(writeBlob|writeFiles|executeRegister|executeCertify|run)$/]",
          message:
            'Do not use SDK convenience APIs that can sign or execute internally; compose Transactions and use runTx.',
        },
      ],
    },
  },
];
