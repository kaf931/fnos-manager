import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';
export default tseslint.config(
  {
    ignores: [
      'server/**',
      'dist/**',
      'build/**',
      'node_modules/**',
      'data/**',
      'tools/**',
      '.web-test/**',
    ],
  },
  {
    files: ['backend/**/*.ts'],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    languageOptions: { globals: globals.node },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { args: 'none', caughtErrors: 'none', ignoreRestSiblings: true, varsIgnorePattern: '^_' },
      ],
      'no-unused-vars': 'off',
      'no-empty': ['error', { allowEmptyCatch: true }],
      'no-control-regex': 'off',
      'no-useless-escape': 'off',
    },
  },
  {
    files: ['web/**/*.js', 'scripts/**/*.js', 'tests/**/*.js', '*.js'],
    extends: [js.configs.recommended],
    languageOptions: { globals: globals.node },
    rules: {
      'no-unused-vars': [
        'error',
        { args: 'none', caughtErrors: 'none', ignoreRestSiblings: true, varsIgnorePattern: '^_' },
      ],
      'no-empty': ['error', { allowEmptyCatch: true }],
      'no-control-regex': 'off',
      'no-useless-escape': 'off',
    },
  },
  {
    files: ['web/**/*.ts', 'web/**/*.tsx'],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    languageOptions: { globals: globals.browser },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/ban-ts-comment': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { args: 'none', caughtErrors: 'none', ignoreRestSiblings: true, varsIgnorePattern: '^_' },
      ],
      'no-unused-vars': 'off',
      'no-undef': 'off',
      'no-restricted-globals': [
        'error',
        'process',
        'Buffer',
        '__dirname',
        '__filename',
        'require',
        'module',
        'global',
      ],
      'no-empty': ['error', { allowEmptyCatch: true }],
      'no-control-regex': 'off',
      'no-useless-escape': 'off',
    },
  },
  {
    files: ['web/**/*.js'],
    languageOptions: {
      globals: {
        ...Object.fromEntries(Object.keys(globals.node).map((name) => [name, 'off'])),
        ...globals.browser,
      },
    },
  },
  {
    // DOM tests explicitly install these two JSDOM globals; production Node files do not.
    files: ['tests/**/*.test.js'],
    languageOptions: { globals: { document: 'readonly', window: 'readonly' } },
  },
  {
    files: ['backend/domain/**/*.ts'],
    rules: { 'no-restricted-imports': ['error', { patterns: ['../persistence/*', '../app/*'] }] },
  },
  {
    files: ['backend/app/**/*.controller.ts'],
    rules: {
      'no-restricted-imports': ['error', { patterns: ['../../persistence/*'] }],
      'no-restricted-syntax': [
        'error',
        {
          selector: 'MemberExpression[property.name="repository"]',
          message: 'Controllers must delegate data access to their application service.',
        },
      ],
    },
  },
);
