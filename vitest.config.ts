import { defineConfig } from "vitest/config";
import { resolve } from "path";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    globals: true,
    setupFiles: ["./vitest.setup.ts"],
    alias: {
      // This mimics the moduleNameMapper in your Jest config
      "~/(.*)": resolve(__dirname, "src/$1"),
    },
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html"],
      exclude: ["**/node_modules/**", "**/dist/**", "**/src/test/**"],
    },
  },
});
