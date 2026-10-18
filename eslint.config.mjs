import tsParser from '@typescript-eslint/parser';
import tseslint from '@typescript-eslint/eslint-plugin';
import eslintConfigPrettier from 'eslint-config-prettier';

export default [
  {
    files: ['src/**/*.ts', 'test/**/*.ts'],
    languageOptions: {
      parser: tsParser,
      sourceType: 'module',
    },
    plugins: {
      '@typescript-eslint': tseslint,
    },
    rules: {
      ...tseslint.configs.recommended.rules,
      '@typescript-eslint/interface-name-prefix': 'off',
      '@typescript-eslint/explicit-function-return-type': 'off',
      '@typescript-eslint/explicit-module-boundary-types': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
  eslintConfigPrettier,
  {
    files: ['src/**/*.ts'],
    ignores: ['src/config/**', 'src/**/*.spec.ts'],
    rules: {
      'no-restricted-properties': [
        'error',
        {
          object: 'process',
          property: 'env',
          message: 'Inject ApiConfigService instead of reading environment variables here.',
        },
      ],
      'no-restricted-imports': [
        'error',
        {
          paths: [
            { name: '@nestjs/config', message: 'Inject ApiConfigService instead.' },
            {
              name: 'dotenv',
              message: 'Load environment through ApiConfigService.fromEnvironment().',
            },
            {
              name: 'dotenv/config',
              message: 'Load environment through ApiConfigService.fromEnvironment().',
            },
          ],
        },
      ],
    },
  },
  {
    ignores: ['dist/**', 'node_modules/**', 'coverage/**'],
  },
];
