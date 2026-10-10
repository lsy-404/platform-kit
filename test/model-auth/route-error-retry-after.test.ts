import { describe, expect, it } from "vitest";
import { CredentialRouter, createCredentialMetadata } from "../../model-auth/packages/core/src/index.js";

const START = Date.parse("2030-01-01T00:00:00Z");

function router() {
  const clock = { time: START };
  const instance = new CredentialRouter(
    [createCredentialMetadata({ id: "key", providerId: "p", authMethod: "api-key", modelIds: ["m"] })],
    { now: () => clock.time },
  );
  return { instance, clock };
}

describe("router rate-limit cooldown", () => {
  it("cools down for the server-provided Retry-After and labels it rate-limited", () => {
    const { instance } = router();
    instance.reportError("key", { kind: "http", status: 429, retryAfterMs: 90_000 });
    expect(instance.health("key")).toEqual({
      health: "cooling-down", cooldownUntilUtc: new Date(START + 90_000).toISOString(), cooldownReason: "rate-limited",
    });
  });

  it("caps the Retry-After at eight times the rate-limit cooldown", () => {
    const { instance } = router();
    instance.reportError("key", { kind: "http", status: 429, retryAfterMs: 3600_000 });
    expect(instance.health("key")?.cooldownUntilUtc).toBe(new Date(START + 8 * 60_000).toISOString());
  });

  it("ignores an unusable Retry-After and falls back to the default cooldown", () => {
    const { instance } = router();
    instance.reportError("key", { kind: "http", status: 429, retryAfterMs: 0 });
    expect(instance.health("key")?.cooldownUntilUtc).toBe(new Date(START + 60_000).toISOString());
  });

  it("labels server and transport failures transient", () => {
    const { instance } = router();
    instance.reportError("key", { kind: "http", status: 503, retryAfterMs: 90_000 });
    expect(instance.health("key")).toMatchObject({ health: "cooling-down", cooldownReason: "transient", cooldownUntilUtc: new Date(START + 15_000).toISOString() });
  });

  it("isolates a credential on 401 without a cooldown reason", () => {
    const { instance } = router();
    instance.reportError("key", { kind: "http", status: 401 });
    expect(instance.health("key")).toEqual({ health: "permanently-failed", cooldownUntilUtc: null });
  });

  it("clears the reason when the cooldown ends or health is reset", () => {
    const { instance, clock } = router();
    instance.reportError("key", { kind: "http", status: 429, retryAfterMs: 1000 });
    clock.time += 1001;
    expect(instance.health("key")).toEqual({ health: "healthy", cooldownUntilUtc: null });
    instance.reportError("key", { kind: "transport" });
    instance.resetHealth("key");
    expect(instance.health("key")).toEqual({ health: "healthy", cooldownUntilUtc: null });
  });
});
