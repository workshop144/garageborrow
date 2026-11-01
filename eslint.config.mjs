import js from "@eslint/js";
import tseslint from "typescript-eslint";
import react from "eslint-plugin-react";
import reactHooks from "eslint-plugin-react-hooks";
import prettier from "eslint-config-prettier";
import globals from "globals";
import { createRequire } from "node:module";

// eslint-plugin-react 7.37 (last release 2025-04) declares eslint <=9 but its
// recommended rules only reach ESLint 10's removed context APIs through
// fallbacks, except `version: "detect"`, which calls context.getFilename().
// So resolve the installed React version ourselves; package.json's
// pnpm.peerDependencyRules allows the eslint 10 peer. Revisit when the plugin
// ships ESLint 10 support (or move to @eslint-react/eslint-plugin).
const reactVersion = createRequire(new URL("./apps/web/package.json", import.meta.url))(
  "react/package.json",
).version;

export default [
  {
    ignores: [
      "**/node_modules/**",
      "**/dist/**",
      "**/build/**",
      "**/.aws-sam/**",
      "**/coverage/**",
      "**/*.tsbuildinfo",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["apps/web/**/*.{ts,tsx}", "packages/ui/**/*.{ts,tsx}"],
    plugins: {
      react,
      "react-hooks": reactHooks,
    },
    languageOptions: {
      globals: {
        ...globals.browser,
      },
      parserOptions: {
        ecmaFeatures: { jsx: true },
      },
    },
    settings: {
      react: { version: reactVersion },
    },
    rules: {
      ...react.configs.recommended.rules,
      ...reactHooks.configs.recommended.rules,
      "react/react-in-jsx-scope": "off",
      "react/prop-types": "off",
    },
  },
  {
    files: [
      "apps/api/**/*.{ts,mjs,js}",
      "packages/shared/**/*.{ts,mjs,js}",
      "scripts/**/*.{ts,mjs,js}",
      "*.{mjs,js,cjs}",
    ],
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
  },
  {
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/consistent-type-imports": ["warn", { prefer: "type-imports" }],
    },
  },
  prettier,
];
