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

  it("bundles the official Ollama PNG mark for both Ollama providers", () => {
    const icon = builtinProviderIcon("ollama")!;
    expect(builtinProviderIcon("ollama-cloud")).toBe(icon);
    const png = Buffer.from(icon.match(/href="data:image\/png;base64,([^"]+)"/)![1]!, "base64");
    expect(png.subarray(1, 4).toString()).toBe("PNG");
    expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([181, 256]);
  });

  it("embeds a raster image only for the Ollama providers", () => {
    const ids = ["ollama", "ollama-cloud", "opencode", "opencode-go", "openai", "anthropic", "github-copilot", "google", "mistral", "deepseek"];
    expect(ids.filter(id => builtinProviderIcon(id)?.includes("data:image"))).toEqual(["ollama", "ollama-cloud"]);
  });

  it("styles icons with fill instead of strokes", () => {
    const css = readFileSync(resolve(src, "style.css"), "utf8");
    expect(css).not.toMatch(/\.model-auth-icon\s*\{[^}]*stroke/);
  });
});
