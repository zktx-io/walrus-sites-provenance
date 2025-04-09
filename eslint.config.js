const eslintPluginPrettier = require('eslint-plugin-prettier');
const eslintPluginJest = require('eslint-plugin-jest');
const eslintPluginGithub = require('eslint-plugin-github');
const eslintPluginJsonc = require('eslint-plugin-jsonc');
const tseslint = require('@typescript-eslint/eslint-plugin');

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
    },
    rules: {
      'prettier/prettier': 'warn',
    },
  },
];
