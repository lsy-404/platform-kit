import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { ICON_PATHS } from "../../model-auth/packages/vue/src/icons";
import { builtinProviderIcon } from "../../model-auth/packages/vue/src/provider-icons";

const src = resolve(import.meta.dirname, "../../model-auth/packages/vue/src");

describe("model auth control icons", () => {
  it("provides path data for every icon name", () => {
    for (const [name, paths] of Object.entries(ICON_PATHS)) {
      expect(paths.length, name).toBeGreaterThan(0);
      for (const d of paths) expect(d).toMatch(/^[Mm]/);
    }
  });

  it("keeps hand-written path data out of Vue components", () => {
    for (const file of readdirSync(src).filter(name => name.endsWith(".vue") && name !== "ModelAuthIcon.vue")) {
      const source = readFileSync(resolve(src, file), "utf8");
      expect(source, file).not.toMatch(/<path\s+d=|<svg/);
    }
  });

  it("bundles the OpenCode mark for the OpenCode Go provider", () => {
    const icon = builtinProviderIcon("opencode-go");
    expect(icon).toContain("<svg");
    expect(builtinProviderIcon("opencode")).toBe(icon);
    expect(builtinProviderIcon("ollama-cloud")).not.toBe(icon);
  });

  it("styles icons with fill instead of strokes", () => {
    const css = readFileSync(resolve(src, "style.css"), "utf8");
    expect(css).not.toMatch(/\.model-auth-icon\s*\{[^}]*stroke/);
  });
});
