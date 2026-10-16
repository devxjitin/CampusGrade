import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Sprint 0 (IMPLEMENTATION_PLAN.md): Playwright/Vitest config and specs
    // run under Node/Playwright's own runtime, not the Next.js app — they
    // don't follow next/react lint conventions (no React import needed,
    // different globals) and are linted by their own tools instead.
    "playwright.config.ts",
    "vitest.config.ts",
    "vitest.setup.ts",
    "e2e/**",
  ]),
]);

export default eslintConfig;
