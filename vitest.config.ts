import { defineConfig } from "vitest/config";
import path from "node:path";

// Unit tests run in Node (the code under test is server-side data/security
// logic). The `@/` alias mirrors tsconfig so tests import the same way the app does.
export default defineConfig({
  resolve: {
    alias: { "@": path.resolve(__dirname, ".") },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    globals: false,
  },
});
