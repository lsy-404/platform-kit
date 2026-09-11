import { defineConfig } from "vitest/config";
import vue from "@vitejs/plugin-vue";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const platformRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export default defineConfig({
  root: platformRoot,
  resolve: {
    alias: {
      vue: resolve(dirname(fileURLToPath(import.meta.url)), "node_modules/vue"),
    },
  },
  plugins: [vue()],
  test: {
    css: true,
    environment: "happy-dom",
    include: ["test/model-auth/**/*.test.ts"],
  },
});
