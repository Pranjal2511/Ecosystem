import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@nexashare/protocol": path.resolve("packages/protocol/src/index.ts"),
      "@nexashare/shared": path.resolve("packages/shared/src/index.ts"),
      "@nexashare/validation": path.resolve("packages/validation/src/index.ts"),
      "@nexashare/transfer-core": path.resolve("packages/transfer-core/src/index.ts")
    }
  },
  test: {
    include: ["tests/**/*.test.ts", "packages/**/src/**/*.test.ts"],
    exclude: ["**/node_modules/**", "**/dist/**", "apps/android/**"],
    testTimeout: 30000,
    hookTimeout: 30000,
    fileParallelism: false
  }
});
