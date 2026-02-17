import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";
import path from "path";

export default defineConfig({
  plugins: [
    tsconfigPaths({
      projects: [path.resolve(__dirname, "tsconfig.json")],
    }),
  ],

  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },

  test: {
    environment: "node",
    globals: true,
    include: ["src/**/*.test.ts", "src/**/_test_/**/*.ts"],
    exclude: ["node_modules", "dist"],
    clearMocks: true,
  },
});
