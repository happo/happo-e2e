import { defineConfig, globalIgnores } from 'eslint/config';
import globals from 'globals';
import js from '@eslint/js';
import configPrettier from 'eslint-config-prettier';

export default defineConfig([
  globalIgnores(['browser.build.js']),

  js.configs.recommended,
  configPrettier,

  {
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.commonjs,
        ...globals.node,
      },

      sourceType: 'module',
      ecmaVersion: 2020,
      parserOptions: {},
    },

    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: 'ChainExpression',
          message: 'Optional chaining (?.) is not supported in Webpack 4',
        },
        {
          selector: 'LogicalExpression[operator="??"]',
          message: 'Nullish coalescing operator (??) is not supported in Webpack 4',
        },
        {
          selector: 'ClassProperty',
          message: 'Class fields are not supported in Webpack 4',
        },
      ],
    },
  },
]);
