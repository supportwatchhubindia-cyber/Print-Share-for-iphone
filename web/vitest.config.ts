import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  test: {
    include: ["tests/unit/**/*.test.ts"],
    environment: "node",
    env: {
      NODE_ENV: "test",
      DATABASE_URL: "postgresql://unused@localhost:1/unused",
      SIGNING_SECRET: "unit-test-signing-secret-0123456789abcdef0123",
      STORAGE_DIR: "./storage-test",
    },
  },
});
