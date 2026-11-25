import { fileURLToPath } from "node:url";
import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";
import { defineConfig } from "eslint/config";
import prettierConfig from "eslint-config-prettier";

export default defineConfig([
  { ignores: ["dist/**", "test/**"] },
  { files: ["**/*.{js,mjs,cjs,ts,mts,cts}"], plugins: { js }, extends: ["js/recommended"], languageOptions: { globals: globals.browser } },
  ...tseslint.configs.recommended,
  {
    files: ["src/**/*.ts"],
    languageOptions: {
      parserOptions: {
        project: "./tsconfig.json",
        tsconfigRootDir: fileURLToPath(new URL(".", import.meta.url)),
      },
    },
    rules: { "@typescript-eslint/no-deprecated": "error" },
  },
  prettierConfig,
]);
