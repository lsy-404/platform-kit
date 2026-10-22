import { defineConfig } from "vitest/config";
export default defineConfig({ test: { include: ["test/fluent-*.test.ts", "test/visual-center.test.ts", "test/toast.test.ts", "test/liquid-glass.test.ts"] } });
