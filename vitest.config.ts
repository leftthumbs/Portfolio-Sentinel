import path from "path";
import { defineConfig } from "vitest/config";

// Standalone from vite.config.ts, which roots itself at client/ for the SPA
// build. Tests live alongside the server code they cover.
export default defineConfig({
  resolve: {
    alias: {
      "@shared": path.resolve(import.meta.dirname, "shared"),
      "@": path.resolve(import.meta.dirname, "client", "src"),
    },
  },
  test: {
    environment: "node",
    include: ["server/**/*.test.ts", "shared/**/*.test.ts"],
  },
});
