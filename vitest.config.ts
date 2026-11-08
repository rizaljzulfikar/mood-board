import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: { "@": path.resolve(__dirname, "src") },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    // DB-backed tests share the moodboard-test database and clean it with
    // deleteMany({}) — running files in parallel races those cleanups.
    fileParallelism: false,
    env: {
      JWT_SECRET: "test-secret-0123456789abcdef-test-secret",
      MONGODB_URI: "mongodb://localhost:27030/moodboard",
      MINIO_ENDPOINT: "http://localhost:9100",
      MINIO_ACCESS_KEY: "moodboard",
      MINIO_SECRET_KEY: "moodboard-secret",
      MINIO_BUCKET: "moodboard",
    },
    testTimeout: 30000,
  },
});
