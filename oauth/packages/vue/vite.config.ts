import vue from "@vitejs/plugin-vue";
import { defineConfig } from "vite";
import { resolve } from "node:path";

export default defineConfig({
  plugins: [vue()],
  build: {
    lib: { entry: resolve(import.meta.dirname, "src/index.ts"), formats: ["es"], fileName: "model-auth-vue", cssFileName: "model-auth" },
    rollupOptions: {
      external: ["vue"],
      output: { banner: 'import "./model-auth.css";' },
    },
  },
});
