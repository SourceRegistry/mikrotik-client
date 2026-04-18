import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    exclude: ["old/**", "dist/**", "node_modules/**"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html"],
    },
    globals: true,
    environment: "node",
  },
});
