import { builtinModules } from "node:module";
import { resolve } from "node:path";
import { defineConfig } from "vite";
import dts from "vite-plugin-dts";

const external = new Set<string>([
  ...builtinModules,
  ...builtinModules.map((module) => `node:${module}`),
]);

export default defineConfig({
  build: {
    lib: {
      entry: {
        index: resolve(__dirname, "src/index.ts"),
        "routeros/index": resolve(__dirname, "src/routeros/index.ts"),
        "switchos/index": resolve(__dirname, "src/switchos/index.ts"),
      },
      formats: ["es", "cjs"],
      fileName: (format, entryName) =>
        format === "cjs" ? `${entryName}.cjs` : `${entryName}.js`,
    },
    rollupOptions: {
      external: [...external],
    },
    sourcemap: true,
    target: "node18",
  },
  plugins: [
    dts({
      include: ["src/**/*.ts"],
      compilerOptions: {
        stripInternal: false,
        removeComments: false,
      },
    }),
  ],
});
