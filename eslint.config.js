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
      'prettier/prettier': 'warn',
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
];
