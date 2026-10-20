import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createUsageGate } from "../../model-auth/packages/core/src/index.js";

const basePolicy = { minIntervalMs: () => 0, random: () => 0 };
const deferred = <T = void>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
};
const tick = async (ms = 0) => { await vi.advanceTimersByTimeAsync(ms); };

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("UsageGate scheduler", () => {
  it("prioritizes manual work and promotes a queued timer", async () => {
    const gate = createUsageGate({ ...basePolicy, maxConcurrent: 1 });
    const release = deferred();
    const started = deferred();
    const order: string[] = [];
    const holder = gate.run("holder", { providerId: "p", reason: "timer" }, async () => { started.resolve(); await release.promise; });
    await started.promise;
    const timer = gate.run("a", { providerId: "p", reason: "timer" }, async () => { order.push("timer"); return "timer"; });
    const promoted = gate.run("a", { providerId: "p", reason: "manual" }, async () => { order.push("manual callback"); return "manual"; });
    const other = gate.run("b", { providerId: "p", reason: "view" }, async () => { order.push("view"); });
    release.resolve();
    await tick();
    await Promise.all([holder, timer, promoted, other]);
    expect(order).toEqual(["timer", "view"]);
    expect(await timer).toMatchObject({ ran: true, value: "timer" });
    expect(await promoted).toMatchObject({ ran: true, value: "timer" });
  });

  it("enforces queue bounds and lets callers cancel queued work", async () => {
    const gate = createUsageGate({ ...basePolicy, maxConcurrent: 1, maxQueueSize: 1 });
    const release = deferred();
    const started = deferred();
    const holder = gate.run("holder", { providerId: "p", reason: "timer" }, async () => { started.resolve(); await release.promise; });
    await started.promise;
    const controller = new AbortController();
    const removeListener = vi.spyOn(controller.signal, "removeEventListener");
    const cancelled = gate.run("queued", { providerId: "p", reason: "manual" }, async () => "no", { signal: controller.signal });
    const full = await gate.run("overflow", { providerId: "p", reason: "manual" }, async () => "no");
    controller.abort();
    expect(await cancelled).toMatchObject({ ran: false, status: "cancelled" });
    expect(removeListener).toHaveBeenCalledWith("abort", expect.any(Function));
    expect(full).toMatchObject({ ran: false, status: "queue-full" });
    release.resolve();
    await holder;
  });

  it("cancels queued background jobs and times out queue waits", async () => {
    const gate = createUsageGate({ ...basePolicy, maxConcurrent: 1, queueTimeoutMs: 25 });
    const release = deferred();
    const started = deferred();
    const holder = gate.run("holder", { providerId: "p", reason: "manual" }, async () => { started.resolve(); await release.promise; });
    await started.promise;
    const background = gate.run("bg", { providerId: "p", reason: "view" }, async () => "no");
    const timed = gate.run("timeout", { providerId: "p", reason: "manual" }, async () => "no");
    expect(gate.cancelPendingBackground()).toBe(1);
    expect(await background).toMatchObject({ ran: false, status: "cancelled" });
    await tick(25);
    expect(await timed).toMatchObject({ ran: false, status: "timed-out" });
    release.resolve();
    await holder;
  });

  it("aborts on execution timeout but retains the slot until an ignoring task settles", async () => {
    const gate = createUsageGate({ ...basePolicy, maxConcurrent: 1, executionTimeoutMs: 20 });
    const release = deferred();
    const started = deferred();
    const signalSeen = deferred<boolean>();
    let secondStarted = false;
    const first = gate.run("a", { providerId: "p", reason: "manual" }, async (signal) => {
      started.resolve();
      signalSeen.resolve(Boolean(signal));
      await release.promise;
      return "late";
    });
    await started.promise;
    expect(await signalSeen.promise).toBe(true);
    const second = gate.run("b", { providerId: "q", reason: "manual" }, async () => { secondStarted = true; });
    await tick(20);
    expect(await first).toMatchObject({ ran: false, status: "timed-out" });
    await tick();
    expect(secondStarted).toBe(false);
    release.resolve();
    await tick();
    expect((await second).ran).toBe(true);
  });

  it("queues credential changes behind the active callback, even with spare global capacity", async () => {
    const gate = createUsageGate({ ...basePolicy, maxConcurrent: 2 });
    const release = deferred();
    const started = deferred();
    let active = 1;
    const oldCallback = gate.run("credential", { providerId: "p", reason: "timer" }, async () => { started.resolve(); await release.promise; active -= 1; return "old"; });
    await started.promise;
    let newCalls = 0;
    let overlap = false;
    const changed = gate.run("credential", { providerId: "p", reason: "credential-changed" }, async () => { newCalls += 1; if (active) overlap = true; active += 1; active -= 1; return "new"; });
    const other = await gate.run("other", { providerId: "q", reason: "manual" }, async () => "other");
    expect(other.ran).toBe(true);
    await tick();
    expect(newCalls).toBe(0);
    release.resolve();
    await Promise.all([oldCallback, changed]);
    expect(newCalls).toBe(1);
    expect(overlap).toBe(false);
    expect(await changed).toMatchObject({ ran: true, value: "new" });
  });

  it("cancelling one coalesced caller leaves the shared manual read running", async () => {
    const gate = createUsageGate(basePolicy);
    const release = deferred();
    const started = deferred();
    const controller = new AbortController();
    let taskSignal: AbortSignal | undefined;
    const first = gate.run("a", { providerId: "p", reason: "timer" }, async (signal) => { taskSignal = signal; started.resolve(); await release.promise; return "shared"; }, { signal: controller.signal });
    await started.promise;
    const manual = gate.run("a", { providerId: "p", reason: "manual" }, async () => "unused");
    controller.abort();
    expect(await first).toMatchObject({ ran: false, status: "cancelled" });
    expect(taskSignal?.aborted).toBe(false);
    release.resolve();
    expect(await manual).toMatchObject({ ran: true, value: "shared" });
  });

  it("does not share a running task after every caller has cancelled", async () => {
    const gate = createUsageGate({ ...basePolicy, maxConcurrent: 2 });
    const release = deferred();
    const started = deferred();
    const controller = new AbortController();
    let oldSignal: AbortSignal | undefined;
    let replacementCalls = 0;
    const old = gate.run("a", { providerId: "p", reason: "timer" }, async (signal) => {
      oldSignal = signal;
      started.resolve();
      await release.promise;
      return "old";
    }, { signal: controller.signal });
    await started.promise;
    controller.abort();
    expect(await old).toMatchObject({ ran: false, status: "cancelled" });
    expect(oldSignal?.aborted).toBe(true);
    const replacement = gate.run("a", { providerId: "p", reason: "manual" }, async () => { replacementCalls += 1; return "new"; });
    await tick();
    expect(replacementCalls).toBe(0);
    release.resolve();
    expect(await replacement).toMatchObject({ ran: true, value: "new" });
    expect(replacementCalls).toBe(1);
  });

  it("isolates scheduled provider ownership from caller mutation", async () => {
    const gate = createUsageGate({ ...basePolicy, maxConcurrent: 1, lane: () => ({ concurrency: 1, minSpacingMs: 0 }) });
    const request = { providerId: "p", reason: "manual" as const };
    const first = gate.run("a", request, async () => "first");
    request.providerId = "q";
    expect(await first).toMatchObject({ ran: true, value: "first" });
    expect(await gate.run("b", { providerId: "p", reason: "manual" }, async () => "second")).toMatchObject({ ran: true, value: "second" });
  });

  it("keeps a queued credential bound to its provider when a conflicting request arrives", async () => {
    const gate = createUsageGate({ ...basePolicy, maxConcurrent: 1 });
    const release = deferred();
    const started = deferred();
    const holder = gate.run("holder", { providerId: "p", reason: "manual" }, async () => { started.resolve(); await release.promise; });
    await started.promise;
    let queuedCalls = 0;
    const queued = gate.run("shared", { providerId: "p", reason: "timer" }, async () => { queuedCalls += 1; return "p"; });
    await expect(gate.run("shared", { providerId: "q", reason: "manual" }, async () => "q")).rejects.toThrow("another provider");
    release.resolve();
    await Promise.all([holder, queued]);
    expect(queuedCalls).toBe(1);
    expect(await queued).toMatchObject({ ran: true, value: "p" });
  });

  it("rejects the same credential being scheduled for a different provider", async () => {
    const gate = createUsageGate(basePolicy);
    const started = deferred();
    const release = deferred();
    const first = gate.run("a", { providerId: "p", reason: "manual" }, async () => { started.resolve(); await release.promise; });
    await started.promise;
    await expect(gate.run("a", { providerId: "q", reason: "manual" }, async () => 1)).rejects.toThrow("another provider");
    release.resolve();
    await first;
  });

  it("rejects unsafe reasons and drains after a policy callback throws", async () => {
    let throwOnce = true;
    const gate = createUsageGate({
      ...basePolicy,
      lane: (providerId) => {
        if (providerId === "bad" && throwOnce) { throwOnce = false; throw new Error("policy failed"); }
        return { concurrency: 1, minSpacingMs: 0 };
      },
    });
    await expect(gate.run("bad", { providerId: "bad", reason: "manual" }, async () => 1)).rejects.toThrow("policy failed");
    expect(() => gate.run("unsafe", { providerId: "p", reason: "toString" as "manual" }, async () => 1)).toThrow("invalid usage read reason");
    expect(await gate.run("good", { providerId: "good", reason: "manual" }, async () => "ok")).toMatchObject({ ran: true, value: "ok" });
  });

  it("lets another provider run while one provider waits for spacing", async () => {
    const gate = createUsageGate({
      ...basePolicy,
      maxConcurrent: 2,
      lane: (providerId) => ({ concurrency: 1, minSpacingMs: providerId === "p" ? 100 : 0 }),
      sleep: () => new Promise<void>(() => undefined),
    });
    const release = deferred();
    const started = deferred();
    const first = gate.run("p1", { providerId: "p", reason: "manual" }, async () => { started.resolve(); await release.promise; });
    await started.promise;
    const waiting = gate.run("p2", { providerId: "p", reason: "timer" }, async () => "p2");
    release.resolve();
    await first;
    await tick();
    expect(await gate.run("q1", { providerId: "q", reason: "manual" }, async () => "q")).toMatchObject({ ran: true, value: "q" });
    expect(gate.cancelPendingBackground()).toBe(1);
    expect(await waiting).toMatchObject({ ran: false, status: "cancelled" });
    expect(await gate.run("q2", { providerId: "q", reason: "manual" }, async () => "after-cancel")).toMatchObject({ ran: true, value: "after-cancel" });
  });

  it("rechecks the manual interval after promoting a queued timer", async () => {
    let time = 0;
    const gate = createUsageGate({
      ...basePolicy,
      maxConcurrent: 1,
      now: () => time,
      minIntervalMs: (_provider, reason) => reason === "manual" ? 1000 : 100,
    });
    await gate.run("a", { providerId: "p", reason: "timer" }, async () => "initial");
    time = 500;
    const release = deferred();
    const started = deferred();
    const blocker = gate.run("blocker", { providerId: "q", reason: "manual" }, async () => { started.resolve(); await release.promise; });
    await started.promise;
    const promoted = gate.run("a", { providerId: "p", reason: "timer" }, async () => "timer");
    const manual = gate.run("a", { providerId: "p", reason: "manual" }, async () => "manual");
    release.resolve();
    await tick();
    await blocker;
    expect(await promoted).toMatchObject({ ran: false, retryAt: 1000 });
    expect(await manual).toMatchObject({ ran: false, retryAt: 1000 });
  });

  it("cleans a provider wait after sleep throws synchronously", async () => {
    let time = 10;
    let throwOnce = true;
    const gate = createUsageGate({
      ...basePolicy,
      now: () => time,
      sleep: (ms) => {
        if (throwOnce) { throwOnce = false; throw new Error("sleep failed"); }
        time += ms;
        return Promise.resolve();
      },
      lane: () => ({ concurrency: 1, minSpacingMs: 50 }),
    });
    await gate.run("first", { providerId: "p", reason: "manual" }, async () => "first");
    await expect(gate.run("second", { providerId: "p", reason: "timer" }, async () => "second")).rejects.toThrow("sleep failed");
    expect(await gate.run("third", { providerId: "p", reason: "manual" }, async () => "third")).toMatchObject({ ran: true, value: "third" });
  });

  it("preserves undefined as a rejected task reason and frees the slot", async () => {
    const gate = createUsageGate({ ...basePolicy, maxConcurrent: 1 });
    await expect(gate.run("a", { providerId: "p", reason: "manual" }, async () => { throw undefined; })).rejects.toBeUndefined();
    expect(await gate.run("b", { providerId: "p", reason: "manual" }, async () => "continued")).toMatchObject({ ran: true, value: "continued" });
  });

  it("spaces starts within a provider lane", async () => {
    let time = 1000;
    const starts: number[] = [];
    const gate = createUsageGate({
      ...basePolicy,
      now: () => time,
      sleep: async (ms) => { time += ms; },
      lane: () => ({ concurrency: 1, minSpacingMs: 200 }),
    });
    await Promise.all(["a", "b", "c"].map((credentialId) => gate.run(credentialId, { providerId: "p", reason: "timer" }, async () => {
      starts.push(time);
      await Promise.resolve();
    })));
    expect(starts).toHaveLength(3);
    expect(starts[1]! - starts[0]!).toBeGreaterThanOrEqual(200);
    expect(starts[2]! - starts[1]!).toBeGreaterThanOrEqual(200);
  });

  it("does not let manual priority bypass provider backoff and continues after failures", async () => {
    const gate = createUsageGate({ ...basePolicy, maxConcurrent: 1 });
    await expect(gate.run("a", { providerId: "p", reason: "timer" }, async () => { throw Object.assign(new Error("busy"), { code: "rate-limited", retryAfterMs: 1000 }); })).rejects.toThrow("busy");
    expect(await gate.run("b", { providerId: "p", reason: "credential-changed" }, async () => "no")).toMatchObject({ ran: false, retryAt: expect.any(Number) });
    expect(await gate.run("c", { providerId: "q", reason: "manual" }, async () => "ok")).toMatchObject({ ran: true, value: "ok" });
  });
});
