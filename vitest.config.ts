import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    typecheck: {
      enabled: false
    }
  },
  resolve: {
    conditions: ["development", "module", "import", "default"]
  }
});
