// @vitest-environment node

import { afterEach, describe, expect, it, vi } from "vitest";
import { createUsageGate, mergeUsageReading } from "../../model-auth/packages/core/src/index.js";
import { queryClaudePrepaidCredits, queryCodexUsage, queryProviderUsage, UsageRequestError, usageErrorSnapshot, usageSnapshot } from "../../model-auth/packages/providers/src/usage.js";
import { queryOllamaUsage } from "../../model-auth/packages/providers/src/ollama.js";
import { queryOpencodeGoKeyUsage } from "../../model-auth/packages/providers/src/opencode.js";

const credential = { access: "synthetic-access" };

async function failureOf(headers: Record<string, string>, status = 429) {
  const fetchImpl = vi.fn(async () => new Response("{}", { status, headers }));
  const error = await queryCodexUsage(credential, { fetchImpl: fetchImpl as unknown as typeof fetch, retryDelayMs: 0 }).then(() => null, (reason: unknown) => reason);
  expect(error).toBeInstanceOf(UsageRequestError);
  return { error: error as UsageRequestError, fetchImpl };
}

afterEach(() => { vi.useRealTimers(); });

describe("usage Retry-After", () => {
  it("reads delay-seconds from a 429 and does not retry inside the request", async () => {
    const { error, fetchImpl } = await failureOf({ "Retry-After": "120" });
    expect(error.code).toBe("rate-limited");
    expect(error.httpStatus).toBe(429);
    expect(error.retryAfterMs).toBe(120_000);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("reads an HTTP-date relative to now", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(Date.parse("1994-11-06T08:49:37Z"));
    const { error } = await failureOf({ "Retry-After": "Sun, 06 Nov 1994 08:51:07 GMT" });
    expect(error.retryAfterMs).toBe(90_000);
  });

  it("clamps a date in the past to zero", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(Date.parse("1994-11-06T08:49:37Z"));
    const { error } = await failureOf({ "Retry-After": "Sun, 06 Nov 1994 08:00:00 GMT" });
    expect(error.retryAfterMs).toBe(0);
  });

  it("leaves retryAfterMs undefined for unusable values and when the header is absent", async () => {
    for (const value of ["abc", "", "-5"]) {
      const { error } = await failureOf({ "Retry-After": value });
      expect(error.retryAfterMs, JSON.stringify(value)).toBeUndefined();
    }
    expect((await failureOf({})).error.retryAfterMs).toBeUndefined();
  });

  it("reads it from a server error as well", async () => {
    const { error } = await failureOf({ "Retry-After": "30" }, 503);
    expect(error.code).toBe("server-error");
    expect(error.retryAfterMs).toBe(30_000);
  });

  it("reads it from a rejected credential too", async () => {
    const { error } = await failureOf({ "Retry-After": "7" }, 401);
    expect(error.code).toBe("signed-out");
    expect(error.retryAfterMs).toBe(7000);
  });
});

describe("usage failure snapshots carry Retry-After", () => {
  it("copies it from a usage request error", () => {
    expect(usageErrorSnapshot("anthropic", "c", new UsageRequestError("rate-limited", "429", 429, 600_000))).toMatchObject({ errorCode: "rate-limited", retryAfterMs: 600_000 });
    expect(usageErrorSnapshot("anthropic", "c", new UsageRequestError("rate-limited", "429", 429)).retryAfterMs).toBeUndefined();
    expect(usageErrorSnapshot("anthropic", "c", new Error("x")).retryAfterMs).toBeUndefined();
  });

  it("is kept by the other usage queries when the server sends it", async () => {
    const throttled = (headers: Record<string, string>) => async () => new Response("{}", { status: 429, headers });
    const fetchImpl = (path: string, headers: Record<string, string>) => (async (input: string | URL | Request) =>
      new URL(String(input)).pathname === path ? new Response("{}", { status: 429, headers }) : new Response("{}", { status: 200 })) as typeof fetch;
    expect(await queryOllamaUsage({ cookie: "wos-session=v", fetchImpl: throttled({ "Retry-After": "300" }) as unknown as typeof fetch }))
      .toMatchObject({ errorCode: "rate-limited", retryAfterMs: 300_000 });
    expect(await queryClaudePrepaidCredits({ fetchImpl: fetchImpl("/api/organizations", { "Retry-After": "120" }) }))
      .toMatchObject({ errorCode: "rate-limited", retryAfterMs: 120_000 });
    expect(await queryOpencodeGoKeyUsage("go-key-123", { fetchImpl: throttled({ "Retry-After": "45" }) as unknown as typeof fetch }))
      .toMatchObject({ errorCode: "rate-limited", retryAfterMs: 45_000 });
  });

  it("survives mergeUsageReading and paces the provider end to end", async () => {
    vi.useFakeTimers();
    const start = Date.parse("2030-01-01T00:00:00Z");
    vi.setSystemTime(start);
    const gate = createUsageGate({ minIntervalMs: () => 0, random: () => 0 });
    const fetchImpl = vi.fn(async () => new Response("{}", { status: 429, headers: { "Retry-After": "300" } })) as unknown as typeof fetch;
    const previous = usageSnapshot("openai-codex", "c1", { plan: "plus", windows: [], balance: { amount: 1, unit: "USD" } });
    const first = await gate.run("c1", { providerId: "openai-codex", reason: "timer" }, async () => {
      try {
        return await queryProviderUsage("openai-codex", credential, { fetchImpl, credentialId: "c1", retryDelayMs: 0 });
      } catch (error) {
        return mergeUsageReading(previous, usageErrorSnapshot("openai-codex", "c1", error));
      }
    });
    expect(first.ran).toBe(true);
    expect(first.retryAt).toBeGreaterThanOrEqual(start + 300_000);
    const second = await gate.run("c2", { providerId: "openai-codex", reason: "manual" }, async () => queryProviderUsage("openai-codex", credential, { fetchImpl, credentialId: "c2" }));
    expect(second).toMatchObject({ ran: false });
    expect(second.retryAt).toBeGreaterThanOrEqual(start + 300_000);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
