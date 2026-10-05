import { describe, expect, it } from "vitest";
import { resetCountdown, tightestWindows, usageTint, windowShortLabel } from "../../model-auth/packages/vue/src/usage.js";
import type { CredentialUsageWindow } from "../../model-auth/packages/vue/src/types.js";

const win = (id: string, usedPercent: number | null, extra: Partial<CredentialUsageWindow> = {}): CredentialUsageWindow => ({ id, label: id, usedPercent, resetAt: null, ...extra });

describe("usage display helpers", () => {
  it("shortens window labels", () => {
    expect(windowShortLabel(win("a", 1, { windowSeconds: 18000 }))).toBe("5h");
    expect(windowShortLabel(win("a", 1, { windowSeconds: 604800 }))).toBe("7d");
    expect(windowShortLabel(win("a", 1, { windowSeconds: 5400 }))).toBe("90m");
    expect(windowShortLabel(win("a", 1, { kind: "monthly" }))).toBe("30d");
    expect(windowShortLabel(win("Custom", 1))).toBe("Custom");
  });

  it("formats reset countdowns", () => {
    const now = 1_000_000_000_000;
    expect(resetCountdown(null, now)).toBeNull();
    expect(resetCountdown(now - 5000, now)).toBe("0m");
    expect(resetCountdown(now + 45 * 60000, now)).toBe("45m");
    expect(resetCountdown(now + 135 * 60000, now)).toBe("2h 15m");
    expect(resetCountdown(now + 120 * 60000, now)).toBe("2h");
    expect(resetCountdown(now + (3 * 1440 + 4 * 60) * 60000, now)).toBe("3d 4h");
  });

  it("tints at 50 and 75 and treats exhaustion separately", () => {
    expect(usageTint(null)).toBe("unknown");
    expect(usageTint(49.9, "known")).toBe("ok");
    expect(usageTint(50)).toBe("warn");
    expect(usageTint(74.9)).toBe("warn");
    expect(usageTint(75)).toBe("danger");
    expect(usageTint(10, "exhausted")).toBe("exhausted");
  });

  it("orders the tightest windows first", () => {
    const windows = [win("a", 20), win("b", null), win("c", 90), win("d", 10, { status: "exhausted" }), win("e", 90)];
    expect(tightestWindows(windows, 3).map(w => w.id)).toEqual(["d", "c", "e"]);
    expect(tightestWindows(windows, 0)).toEqual([]);
    expect(tightestWindows(windows, 10).at(-1)?.id).toBe("b");
  });
});
