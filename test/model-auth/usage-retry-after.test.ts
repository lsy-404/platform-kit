// @vitest-environment node

import { afterEach, describe, expect, it, vi } from "vitest";
import { queryCodexUsage, UsageRequestError } from "../../model-auth/packages/providers/src/usage.js";

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
