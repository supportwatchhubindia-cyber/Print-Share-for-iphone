import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Requires a disposable PostgreSQL database. The schema is reset before the run.
const databaseUrl =
  process.env.TEST_DATABASE_URL ?? "postgresql://printshare@localhost:54329/printshare_test?schema=public";

export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  test: {
    include: ["tests/integration/**/*.test.ts"],
    environment: "node",
    globalSetup: ["tests/integration/global-setup.ts"],
    fileParallelism: false,
    testTimeout: 60_000,
    hookTimeout: 120_000,
    env: {
      NODE_ENV: "test",
      DATABASE_URL: databaseUrl,
      APP_URL: "http://localhost:3000",
      SIGNING_SECRET: "integration-test-signing-secret-0123456789abcdef",
      STORAGE_DIR: "./storage-test",
      MAX_UPLOAD_MB: "10",
      LIBREOFFICE_PATH: "",
      CLAMAV_HOST: "",
    },
  },
});
