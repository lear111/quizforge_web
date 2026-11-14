import js from '@eslint/js';
import globals from 'globals';
import ts from 'typescript-eslint';
import vue from 'eslint-plugin-vue';
import vueParser from 'vue-eslint-parser';
import { root, sourcePatterns } from './scripts/quality/scope.mjs';

const rules = {
  ...js.configs.recommended.rules,
  curly: ['error', 'all'],
  'max-statements-per-line': ['error', { max: 1 }],
  'max-len': [
    'error',
    {
      code: 100,
      tabWidth: 2,
      ignoreUrls: true,
      ignoreStrings: true,
      ignoreTemplateLiterals: true,
      ignoreRegExpLiterals: true,
    },
  ],
  'max-lines-per-function': ['warn', { max: 50, skipBlankLines: true, skipComments: true }],
  'max-lines': ['warn', { max: 300, skipBlankLines: true, skipComments: true }],
};
export default [
  { basePath: root, files: sourcePatterns, rules },
  {
    basePath: root,
    files: ['core/server/v2/**', 'core/test/v2/**', 'core/scripts/**', 'core/eslint.config.mjs'],
    languageOptions: { globals: globals.node },
  },
  {
    basePath: root,
    files: ['core/frontend/src/v2/**/*.{js,ts,vue}', 'examples/v2/**/*.js'],
    languageOptions: { globals: globals.browser },
  },
  {
    basePath: root,
    files: [
      'examples/v2/**/*.js',
      'core/scripts/dev/probe-v2*.mjs',
      'core/scripts/dev/measure-v2-bank-return.mjs',
    ],
    // Browser probes evaluate callbacks in the page, which receives these SDK globals.
    languageOptions: {
      globals: {
        ...globals.browser,
        QF: 'readonly',
        QFRichText: 'readonly',
        QFGrading: 'readonly',
      },
    },
  },
  {
    basePath: root,
    files: ['core/frontend/src/v2/**/*.ts', 'core/shared/v2/**/*.ts'],
    languageOptions: { parser: ts.parser },
    plugins: { '@typescript-eslint': ts.plugin },
    rules: {
      'no-undef': 'off',
      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': 'error',
    },
  },
  {
    basePath: root,
    files: ['core/frontend/src/v2/**/*.vue'],
    languageOptions: { parser: vueParser, parserOptions: { parser: ts.parser } },
    plugins: { vue, '@typescript-eslint': ts.plugin },
    rules: {
      ...rules,
      ...vue.configs['flat/essential'].at(-1).rules,
      'no-undef': 'off',
      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': 'error',
      'vue/no-unused-vars': 'error',
      'max-lines': ['warn', { max: 150, skipBlankLines: true, skipComments: true }],
    },
  },
  {
    basePath: root,
    files: ['core/test/v2/**'],
    rules: { 'max-lines': 'off', 'max-lines-per-function': 'off' },
  },
];
