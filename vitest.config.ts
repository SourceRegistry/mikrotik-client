import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts", "test/**/*.test.ts"],
    exclude: ["old/**", "dist/**", "node_modules/**"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "json-summary", "html"],
      exclude: ["test/**", "old/**", "dist/**", "node_modules/**"],
    },
    globals: true,
    environment: "node",
  },
});
