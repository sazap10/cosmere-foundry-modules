import { defineConfig } from "vite";

export default defineConfig({
  build: {
    outDir: "dist",
    emptyOutDir: true,
    sourcemap: true,
    minify: false,
    lib: {
      entry: "src/index.ts",
      formats: ["es"],
      fileName: () => "table-ledger.js",
    },
  },
  test: {
    globals: true,
    include: ["tests/**/*.test.ts"],
  },
});
