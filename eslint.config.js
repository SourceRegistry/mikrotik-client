import tseslint from "@typescript-eslint/eslint-plugin";
import tsparser from "@typescript-eslint/parser";
import n from "eslint-plugin-n";
import unicorn from "eslint-plugin-unicorn";

const sharedRules = {
  "@typescript-eslint/no-explicit-any": "error",
  "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
  "@typescript-eslint/explicit-function-return-type": "off",
  "@typescript-eslint/consistent-type-imports": ["error", { prefer: "type-imports" }],
  "no-console": "warn",
};

export default [
  {
    ignores: ["dist/**", "docs/**", "node_modules/**", "examples/**"],
  },
  // Source files — project-aware linting
  {
    files: ["src/**/*.ts"],
    ignores: ["src/**/*.test.ts"],
    languageOptions: {
      parser: tsparser,
      parserOptions: {
        project: "./tsconfig.json",
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: {
      "@typescript-eslint": tseslint,
      n,
      unicorn,
    },
    rules: {
      ...tseslint.configs["recommended"].rules,
      ...sharedRules,
    },
  },
  // Test files (src and test/) — separate tsconfig that includes *.test.ts
  {
    files: ["src/**/*.test.ts", "test/**/*.ts"],
    languageOptions: {
      parser: tsparser,
      parserOptions: {
        project: "./tsconfig.test.json",
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: {
      "@typescript-eslint": tseslint,
    },
    rules: {
      ...tseslint.configs["recommended"].rules,
      ...sharedRules,
      // Tests legitimately use any for mocks
      "@typescript-eslint/no-explicit-any": "off",
    },
  },
];
