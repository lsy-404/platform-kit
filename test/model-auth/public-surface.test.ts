import { describe, expect, it } from "vitest";
import { MODEL_AUTH_VERSION } from "../../model-auth/packages/core/src/index.js";

describe("public package surface", () => {
  it("exposes a semantic package version", () => {
    expect(MODEL_AUTH_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
