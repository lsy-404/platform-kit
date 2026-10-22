// @vitest-environment node

vi.mock("../../model-auth/packages/providers/src/client-versions.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../model-auth/packages/providers/src/client-versions.js")>();
  return { ...actual, latestClientVersion: async () => "2.1.290" };
});

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { authorizeAnthropicInBrowser } from "../../model-auth/packages/providers/src/anthropic-browser.js";

describe("authorizeAnthropicInBrowser", () => {
  it("rejects arguments outside the proxy allowlist and removes its temporary profile", async () => {
    const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), "anthropic-browser-test-"));
    vi.spyOn(os, "tmpdir").mockReturnValue(temporaryRoot);
    try {
      await expect(authorizeAnthropicInBrowser({
        executablePath: "browser",
        browserArgs: ["--disable-web-security"],
        fetchImpl: async () => new Response("{}"),
      })).rejects.toMatchObject({ code: "browser" });
      expect(await fs.readdir(temporaryRoot)).toEqual([]);
    } finally {
      vi.restoreAllMocks();
      await fs.rm(temporaryRoot, { recursive: true, force: true });
    }
  });

  it("returns the standard aborted error without opening a pre-cancelled session", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(authorizeAnthropicInBrowser({ executablePath: "browser", signal: controller.signal }))
      .rejects.toMatchObject({ code: "aborted" });
  });
});
