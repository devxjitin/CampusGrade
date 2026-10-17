import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";
import path from "node:path";

// Sprint 0 (the original implementation plan): unit-test harness for src/lib and
// src/hooks. Component tests use @testing-library/react on top of this.
export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    setupFiles: ["./vitest.setup.ts"],
    globals: true,
    css: false,
    // e2e/**/*.spec.ts files use Playwright's own test() from
    // @playwright/test, which conflicts with vitest's globals: true test()
    // if vitest's default include glob picks them up too. Those specs run
    // only under `npx playwright test`, never under `vitest run`.
    exclude: ["**/node_modules/**", "**/dist/**", "**/.{idea,git,cache,output,temp}/**", "e2e/**"],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
