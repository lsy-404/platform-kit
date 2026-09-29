import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { fluentIcon } from "../styles/fluent/src/vue/icon.js";

describe("Fluent icon source", () => {
  it("renders filled Fluent System Icons paths without hand-written strokes", async () => {
    for (const name of ["check", "chevron-down", "chevron-up", "upload"] as const) {
      const node = fluentIcon(name);
      expect(node.props?.viewBox).toBe("0 0 16 16");
      expect(node.props?.fill).toBe("currentColor");
      expect(node.props?.stroke).toBeUndefined();
      expect((node.children as unknown[]).length).toBeGreaterThan(0);
    }
    const feedback = await readFile(new URL("../styles/fluent/src/vue/feedback.ts", import.meta.url), "utf8");
    expect(feedback).not.toMatch(/h\("path"/);
  });
});
