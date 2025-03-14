module.exports = {
  env: {
    browser: true,
    commonjs: true,
    es6: true,
    node: true,
  },
  extends: ['eslint:recommended', 'prettier'],
  globals: {
    Atomics: 'readonly',
    Cypress: 'readonly',
    SharedArrayBuffer: 'readonly',
    after: 'readonly',
    before: 'readonly',
    cy: 'readonly',
    describe: 'readonly',
    it: 'readonly',
    globalThis: 'readonly',
  },
  ignorePatterns: ['pages/'],
  parserOptions: {
    sourceType: 'module',
    ecmaVersion: 2020,
  },
  rules: {
    'no-use-before-define': 2,
  },
};
