import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import { defineConfig } from 'eslint/config';
import prettierConfig from 'eslint-config-prettier';

export default defineConfig([
  { ignores: ['dist/**', 'test/**', 'extracted_files/**'] },
  { files: ['**/*.{js,mjs,cjs,ts,mts,cts}'], languageOptions: { globals: globals.node } },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  { files: ['integration/**/*.cjs'], rules: { '@typescript-eslint/no-require-imports': 'off' } },
  prettierConfig,
]);
