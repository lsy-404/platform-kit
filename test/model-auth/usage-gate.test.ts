import { describe, expect, it } from "vitest";
import { createUsageGate, parseRetryAfter, type UsageGatePolicy, type UsageReadReason } from "../../model-auth/packages/core/src/index.js";

const MINUTE = 60_000;
const START = Date.parse("2030-01-01T00:00:00Z");

function clock() {
  const state = { time: START };
  return {
    state,
    now: () => state.time,
    // Virtual time: sleeping advances the clock instead of waiting.
    sleep: async (ms: number) => { state.time += Math.max(0, ms); },
    advance: (ms: number) => { state.time += ms; },
  };
}

const INTERVALS: Record<UsageReadReason, number> = { timer: 4.5 * MINUTE, view: 4.5 * MINUTE, manual: MINUTE, "credential-changed": 0 };

function setup(over: Partial<UsageGatePolicy> = {}) {
  const time = clock();
  const gate = createUsageGate({ minIntervalMs: (_provider, reason) => INTERVALS[reason], now: time.now, sleep: time.sleep, random: () => 0.999, ...over });
  return { time, gate };
}

const rateLimited = (retryAfterMs?: number) => Object.assign(new Error("429 Too Many Requests"), { code: "rate-limited", ...(retryAfterMs === undefined ? {} : { retryAfterMs }) });
const fail = async (error: Error) => { throw error; };

describe("parseRetryAfter (RFC 9110 section 10.2.3)", () => {
  const now = Date.parse("1994-11-06T08:49:37Z");

  it("reads delay-seconds as milliseconds", () => {
    expect(parseRetryAfter("120", now)).toBe(120_000);
    expect(parseRetryAfter("0", now)).toBe(0);
    expect(parseRetryAfter(" 5 ", now)).toBe(5000);
  });

  it("reads an HTTP-date relative to now and clamps a past date to zero", () => {
    expect(parseRetryAfter("Sun, 06 Nov 1994 08:51:07 GMT", now)).toBe(90_000);
    expect(parseRetryAfter("Sun, 06 Nov 1994 08:00:00 GMT", now)).toBe(0);
  });

  it("rejects anything else", () => {
    for (const value of ["abc", "", "   ", "-5", "1.5", "5s", "1e3", null, undefined]) expect(parseRetryAfter(value, now), String(value)).toBeNull();
  });

  it("rejects weekday-prefixed text that is not one of the three HTTP-date formats", () => {
    for (const value of [
      "Mon, 1", "Monday 5", "Sun foo 2030", "Sun, 06 Nov 1994 08:51:07", "Sun, 6 Nov 1994 08:51:07 GMT",
      "Sat, 31 Feb 2026 00:00:00 GMT", "Sun, 06 Nov 1994 25:00:00 GMT", "Sun, 06 Nov 1994 08:51:07 PST",
      "Sunday, 06 Nov 1994 08:51:07 GMT", "Sun, 06-Nov-94 08:51:07 GMT",
    ]) expect(parseRetryAfter(value, now), value).toBeNull();
  });

  it("reads the obsolete rfc850 and asctime dates as UTC", () => {
    expect(parseRetryAfter("Sunday, 06-Nov-94 08:51:07 GMT", now)).toBe(90_000);
    expect(parseRetryAfter("Sun Nov  6 08:51:07 1994", now)).toBe(90_000);
    expect(parseRetryAfter("Sun Nov 06 08:51:07 1994", now)).toBe(90_000);
    expect(parseRetryAfter("Sun Nov  6 08:00:00 1994", now)).toBe(0);
  });

  it("reads a two-digit rfc850 year as the nearest year within fifty years ahead", () => {
    const later = Date.parse("2026-10-10T00:00:00Z");
    expect(parseRetryAfter("Saturday, 10-Oct-26 00:01:30 GMT", later)).toBe(90_000);
    expect(parseRetryAfter("Sunday, 06-Nov-94 08:51:07 GMT", later)).toBe(0);
  });
});

describe("createUsageGate", () => {
  it("runs one task for concurrent calls on the same credential", async () => {
    const { gate } = setup();
    let calls = 0;
    const task = async () => { calls += 1; return "reading"; };
    const [first, second] = await Promise.all([
      gate.run("a", { providerId: "p", reason: "timer" }, task),
      gate.run("a", { providerId: "p", reason: "view" }, task),
    ]);
    expect(calls).toBe(1);
    expect(first).toMatchObject({ ran: true, value: "reading" });
    expect(second).toMatchObject({ ran: true, value: "reading" });
  });

  it("skips a read inside the minimum interval of its reason, measured from the last start", async () => {
    const { gate, time } = setup();
    let calls = 0;
    const task = async () => { calls += 1; time.advance(10_000); return calls; };
    await gate.run("a", { providerId: "p", reason: "timer" }, task);
    time.advance(30_000);
    const blocked = await gate.run("a", { providerId: "p", reason: "view" }, task);
    expect(blocked).toEqual({ ran: false, retryAt: START + 4.5 * MINUTE });
    expect(calls).toBe(1);

    // A manual read has a shorter interval than a timer read.
    expect(await gate.run("a", { providerId: "p", reason: "manual" }, task)).toEqual({ ran: false, retryAt: START + MINUTE });
    time.advance(20_000);
    expect((await gate.run("a", { providerId: "p", reason: "manual" }, task)).ran).toBe(true);
    expect(calls).toBe(2);
  });

  it("lets a credential change through the interval but not a backoff", async () => {
    const { gate } = setup();
    let calls = 0;
    const task = async () => { calls += 1; };
    await gate.run("a", { providerId: "p", reason: "timer" }, task);
    expect((await gate.run("a", { providerId: "p", reason: "credential-changed" }, task)).ran).toBe(true);
    expect(calls).toBe(2);
  });

  it("backs the whole provider off after a 429 with Retry-After, whatever the reason or credential", async () => {
    const { gate, time } = setup();
    await expect(gate.run("a", { providerId: "p", reason: "timer" }, () => fail(rateLimited(600_000)))).rejects.toThrow("429");
    let calls = 0;
    const task = async () => { calls += 1; };
    for (const reason of ["timer", "view", "manual", "credential-changed"] as const) {
      const result = await gate.run("b", { providerId: "p", reason }, task);
      expect(result.ran, reason).toBe(false);
      expect(result.retryAt, reason).toBeGreaterThanOrEqual(START + 600_000);
      expect(result.retryAt, reason).toBeLessThanOrEqual(START + 605_000);
    }
    expect(calls).toBe(0);

    time.advance(605_001);
    expect((await gate.run("b", { providerId: "p", reason: "timer" }, task)).ran).toBe(true);
  });

  it("does not let another provider ride the backoff", async () => {
    const { gate } = setup();
    await expect(gate.run("a", { providerId: "p", reason: "timer" }, () => fail(rateLimited(600_000)))).rejects.toThrow();
    expect((await gate.run("x", { providerId: "q", reason: "timer" }, async () => 1)).ran).toBe(true);
  });

  it("treats a returned failure snapshot like a thrown one and reports the retry time", async () => {
    const { gate } = setup();
    const result = await gate.run("a", { providerId: "p", reason: "timer" }, async () => ({ status: "error", errorCode: "rate-limited", retryAfterMs: 300_000 }));
    expect(result.ran).toBe(true);
    expect(result.retryAt).toBeGreaterThanOrEqual(START + 300_000);
    expect(result.retryAt).toBeLessThanOrEqual(START + 305_000);
    expect((await gate.run("b", { providerId: "p", reason: "credential-changed" }, async () => 1)).ran).toBe(false);
  });

  it("counts one burst of concurrent failures as a single step of the backoff", async () => {
    const { gate } = setup();
    await Promise.allSettled([1, 2, 3, 4].map((id) => gate.run(`c${id}`, { providerId: "p", reason: "timer" }, () => fail(rateLimited()))));
    const blocked = await gate.run("d", { providerId: "p", reason: "manual" }, async () => 1);
    expect(blocked.retryAt).toBeGreaterThanOrEqual(START + 60_000);
    expect(blocked.retryAt).toBeLessThanOrEqual(START + 65_000);
  });

  it("does not let a failure that carried Retry-After raise the next backoff", async () => {
    const { gate, time } = setup();
    await expect(gate.run("a", { providerId: "p", reason: "credential-changed" }, () => fail(rateLimited(30_000)))).rejects.toThrow();
    time.advance(35_001);
    const before = time.now();
    await expect(gate.run("a", { providerId: "p", reason: "credential-changed" }, () => fail(rateLimited()))).rejects.toThrow();
    const blocked = await gate.run("b", { providerId: "p", reason: "manual" }, async () => 1);
    expect(blocked.retryAt! - before).toBeGreaterThanOrEqual(60_000);
    expect(blocked.retryAt! - before).toBeLessThanOrEqual(65_000);
  });

  it("runs a credential-changed task after a read of that credential that was already queued", async () => {
    const { gate } = setup({ lane: () => ({ concurrency: 1, minSpacingMs: 0 }) });
    const order: string[] = [];
    let release!: () => void;
    const holder = gate.run("other", { providerId: "p", reason: "timer" }, () => new Promise<void>((resolve) => { release = resolve; }));
    const queued = gate.run("a", { providerId: "p", reason: "timer" }, async () => { order.push("old credential"); return "old"; });
    await Promise.resolve();
    const changed = gate.run("a", { providerId: "p", reason: "credential-changed" }, async () => { order.push("new credential"); return "new"; });
    release();
    await holder;
    expect(await queued).toMatchObject({ ran: true, value: "old" });
    expect(await changed).toMatchObject({ ran: true, value: "new" });
    expect(order).toEqual(["old credential", "new credential"]);
  });

  it("caps a long Retry-After at one hour plus jitter", async () => {
    const { gate } = setup();
    await expect(gate.run("a", { providerId: "p", reason: "timer" }, () => fail(rateLimited(2 * 3600_000)))).rejects.toThrow();
    const blocked = await gate.run("b", { providerId: "p", reason: "manual" }, async () => 1);
    expect(blocked.retryAt).toBeGreaterThanOrEqual(START + 3600_000);
    expect(blocked.retryAt).toBeLessThanOrEqual(START + 3600_000 + 5000);
  });

  it("backs off exponentially without Retry-After, from 60 s up to 30 min", async () => {
    const { gate, time } = setup();
    const delays: number[] = [];
    for (let attempt = 0; attempt < 8; attempt++) {
      const before = time.now();
      await expect(gate.run("a", { providerId: "p", reason: "credential-changed" }, () => fail(rateLimited()))).rejects.toThrow();
      const blocked = await gate.run("a", { providerId: "p", reason: "credential-changed" }, async () => 1);
      delays.push(blocked.retryAt! - before);
      time.advance(blocked.retryAt! - time.now());
    }
    expect(delays[0]).toBeGreaterThanOrEqual(60_000);
    expect(delays[0]).toBeLessThanOrEqual(65_000);
    expect(delays[1]).toBeGreaterThanOrEqual(120_000);
    expect(delays[2]).toBeGreaterThanOrEqual(240_000);
    for (const delay of delays) expect(delay).toBeLessThanOrEqual(30 * MINUTE + 5000);
    expect(delays.at(-1)).toBeGreaterThanOrEqual(30 * MINUTE);
  });

  it("applies server errors to the lane too, but not a signed-out credential", async () => {
    const { gate } = setup();
    await expect(gate.run("a", { providerId: "p", reason: "timer" }, () => fail(Object.assign(new Error("401"), { code: "signed-out" })))).rejects.toThrow();
    expect((await gate.run("b", { providerId: "p", reason: "timer" }, async () => 1)).ran).toBe(true);
    await expect(gate.run("c", { providerId: "p", reason: "timer" }, () => fail(Object.assign(new Error("503"), { code: "server-error" })))).rejects.toThrow();
    expect((await gate.run("d", { providerId: "p", reason: "timer" }, async () => 1)).ran).toBe(false);
  });

  it("resets the lane on success so the next failure starts from the base delay", async () => {
    const { gate, time } = setup();
    for (let attempt = 0; attempt < 3; attempt++) {
      await expect(gate.run("a", { providerId: "p", reason: "credential-changed" }, () => fail(rateLimited()))).rejects.toThrow();
      const blocked = await gate.run("a", { providerId: "p", reason: "credential-changed" }, async () => 1);
      time.advance(blocked.retryAt! - time.now());
    }
    expect((await gate.run("a", { providerId: "p", reason: "credential-changed" }, async () => "ok")).ran).toBe(true);
    const before = time.now();
    await expect(gate.run("a", { providerId: "p", reason: "credential-changed" }, () => fail(rateLimited()))).rejects.toThrow();
    const blocked = await gate.run("a", { providerId: "p", reason: "credential-changed" }, async () => 1);
    expect(blocked.retryAt! - before).toBeLessThanOrEqual(65_000);
  });

  it("never overlaps reads of a capped provider and spaces their starts", async () => {
    const { gate, time } = setup({ lane: (providerId) => providerId === "p" ? { concurrency: 1, minSpacingMs: 2000 } : { concurrency: Infinity, minSpacingMs: 0 } });
    let active = 0;
    let peak = 0;
    const starts: number[] = [];
    const task = async () => {
      active += 1;
      peak = Math.max(peak, active);
      starts.push(time.now());
      await Promise.resolve();
      await Promise.resolve();
      active -= 1;
    };
    await Promise.all(["a", "b", "c"].map((id) => gate.run(id, { providerId: "p", reason: "timer" }, task)));
    expect(starts).toHaveLength(3);
    expect(peak).toBe(1);
    expect(starts[1]! - starts[0]!).toBeGreaterThanOrEqual(2000);
    expect(starts[2]! - starts[1]!).toBeGreaterThanOrEqual(2000);
  });

  it("does not start a queued read once an earlier read in the lane hit a rate limit", async () => {
    const { gate } = setup({ lane: () => ({ concurrency: 1, minSpacingMs: 2000 }) });
    let secondCalls = 0;
    const [first, second] = await Promise.allSettled([
      gate.run("a", { providerId: "p", reason: "timer" }, () => fail(rateLimited(300_000))),
      gate.run("b", { providerId: "p", reason: "timer" }, async () => { secondCalls += 1; }),
    ]);
    expect(first.status).toBe("rejected");
    expect(second.status).toBe("fulfilled");
    expect(secondCalls).toBe(0);
    expect((second as PromiseFulfilledResult<{ ran: boolean }>).value.ran).toBe(false);
  });

  it("refuses at once while backing off instead of waiting for its place in the lane", async () => {
    const { gate, time } = setup({ lane: () => ({ concurrency: 1, minSpacingMs: 2000 }) });
    await expect(gate.run("a", { providerId: "p", reason: "timer" }, () => fail(rateLimited(300_000)))).rejects.toThrow();
    const before = time.now();
    expect((await gate.run("b", { providerId: "p", reason: "manual" }, async () => 1)).ran).toBe(false);
    expect(time.now()).toBe(before);
  });

  it("honours a global concurrency cap across providers", async () => {
    const { gate } = setup({ maxConcurrent: 2 });
    let active = 0;
    let peak = 0;
    const task = async () => { active += 1; peak = Math.max(peak, active); await Promise.resolve(); await Promise.resolve(); active -= 1; };
    await Promise.all(["a", "b", "c", "d"].map((id, index) => gate.run(id, { providerId: `p${index}`, reason: "timer" }, task)));
    expect(peak).toBe(2);
  });
});
