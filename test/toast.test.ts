import { describe, expect, it, vi } from "vitest";
import { readFile } from "node:fs/promises";
import {
  createToastStore,
  defaultToastRate,
  toastAnnouncement,
  unfocusedRateOf,
  type ToastAttention,
  type ToastClock,
} from "../styles/toast/src/core.js";
import { ToastCard, ToastHost } from "../styles/toast/src/vue.js";

function manualClock() {
  let now = 0;
  let nextHandle = 1;
  const timers = new Map<number, { at: number; callback: () => void }>();
  const clock: ToastClock = {
    now: () => now,
    setTimeout(callback, delay) {
      const handle = nextHandle++;
      timers.set(handle, { at: now + delay, callback });
      return handle;
    },
    clearTimeout(handle) {
      timers.delete(handle as number);
    },
  };
  function advance(ms: number) {
    const end = now + ms;
    for (;;) {
      const due = [...timers.entries()]
        .filter(([, timer]) => timer.at <= end)
        .sort((a, b) => a[1].at - b[1].at)[0];
      if (!due) break;
      timers.delete(due[0]);
      now = due[1].at;
      due[1].callback();
    }
    now = end;
  }
  return { clock, advance, pending: () => timers.size };
}

const fixedRate = (focused: number, idle = 1, engaged = 0) => (attention: ToastAttention) =>
  attention.engaged ? engaged : attention.focused ? focused : idle;

describe("toast store", () => {
  it("dismisses after the idle duration and keeps sticky toasts", () => {
    const { clock, advance } = manualClock();
    const store = createToastStore({ clock, rate: fixedRate(2) });
    const timed = store.success("Saved");
    const sticky = store.push("Restart pending", { duration: 0 });
    advance(2999);
    expect(store.snapshot().map((toast) => toast.id)).toEqual([timed, sticky]);
    advance(1);
    expect(store.snapshot().map((toast) => toast.id)).toEqual([sticky]);
    expect(store.progress(sticky)).toBe(1);
  });

  it("gives errors the longer default", () => {
    const { clock } = manualClock();
    const store = createToastStore({ clock, rate: fixedRate(2) });
    store.error("Failed");
    store.info("Note");
    expect(store.snapshot().map((toast) => toast.duration)).toEqual([5000, 3000]);
  });

  it("carries elapsed time across rate changes", () => {
    const { clock, advance } = manualClock();
    const store = createToastStore({ clock, rate: fixedRate(2) });
    const id = store.info("Hello");
    advance(1000);
    store.setAttention({ focused: true });
    expect(store.rate()).toBe(2);
    expect(store.progress(id)).toBeCloseTo(2 / 3);
    advance(999);
    expect(store.snapshot()).toHaveLength(1);
    advance(1);
    expect(store.snapshot()).toHaveLength(0);
  });

  it("pauses while engaged and resumes from the same point", () => {
    const { clock, advance, pending } = manualClock();
    const store = createToastStore({ clock, rate: fixedRate(2) });
    const id = store.info("Hover me");
    advance(1500);
    store.setAttention({ engaged: true });
    expect(pending()).toBe(0);
    advance(60_000);
    expect(store.progress(id)).toBeCloseTo(0.5);
    store.setAttention({ engaged: false });
    advance(1500);
    expect(store.snapshot()).toHaveLength(0);
  });

  it("drops the oldest timed toast beyond the limit but never the newest", () => {
    const { clock } = manualClock();
    const store = createToastStore({ clock, rate: fixedRate(2), limit: 2 });
    const stickyA = store.push("A", { duration: 0 });
    const stickyB = store.push("B", { duration: 0 });
    const timed = store.info("C");
    expect(store.snapshot().map((toast) => toast.id)).toEqual([stickyB, timed]);
    const latest = store.info("D");
    expect(store.snapshot().map((toast) => toast.id)).toEqual([stickyB, latest]);
    expect(stickyA).toBeLessThan(stickyB);
  });

  it("updates in place and notifies subscribers with a fresh snapshot", () => {
    const { clock } = manualClock();
    const store = createToastStore({ clock });
    const seen: unknown[] = [];
    const stop = store.subscribe(() => seen.push(store.snapshot()));
    const id = store.push("Restart in 10s", { duration: 0 });
    const before = store.snapshot();
    store.update(id, { message: "Restart in 9s" });
    expect(store.snapshot()).not.toBe(before);
    expect(store.snapshot()[0]?.message).toBe("Restart in 9s");
    expect(seen).toHaveLength(2);
    stop();
    store.clear();
    expect(seen).toHaveLength(2);
  });

  it("dismisses after an action unless it keeps the toast open", () => {
    const { clock } = manualClock();
    const store = createToastStore({ clock });
    const later = vi.fn();
    const id = store.push("Update ready", {
      duration: 0,
      actions: [{ label: "Later", onClick: later, keepOpen: true }, { label: "Restart", onClick: () => {} }],
    });
    const [keep, restart] = store.snapshot()[0]!.actions;
    store.runAction(id, keep!);
    expect(later).toHaveBeenCalledOnce();
    expect(store.snapshot()).toHaveLength(1);
    store.runAction(id, restart!);
    expect(store.snapshot()).toHaveLength(0);
  });

  it("stops every timer on destroy", () => {
    const { clock, pending } = manualClock();
    const store = createToastStore({ clock });
    store.info("A");
    store.info("B");
    store.destroy();
    expect(pending()).toBe(0);
    expect(store.snapshot()).toEqual([]);
  });
});

describe("default toast rate", () => {
  it("never runs backwards", () => {
    for (const setting of [false, true, 0.25, -1, Number.NaN])
      for (const focused of [true, false])
        for (const engaged of [true, false])
          expect(defaultToastRate({ focused, engaged }, setting)).toBeGreaterThanOrEqual(0);
  });

  it("pauses while the stack is engaged", () => {
    expect(defaultToastRate({ focused: true, engaged: true })).toBe(0);
    expect(defaultToastRate({ focused: false, engaged: true }, true)).toBe(0);
  });

  it("ignores focus by default", () => {
    expect(defaultToastRate({ focused: true, engaged: false })).toBe(1);
    expect(defaultToastRate({ focused: false, engaged: false })).toBe(1);
  });

  it("halves the unfocused rate when enabled and accepts a custom rate", () => {
    expect(defaultToastRate({ focused: true, engaged: false }, true)).toBe(1);
    expect(defaultToastRate({ focused: false, engaged: false }, true)).toBe(0.5);
    expect(defaultToastRate({ focused: false, engaged: false }, 0.25)).toBe(0.25);
    expect(unfocusedRateOf(-1)).toBe(1);
    expect(unfocusedRateOf(Number.NaN)).toBe(1);
  });

  it("stretches display time in a background window when configured", () => {
    const { clock, advance } = manualClock();
    const store = createToastStore({ clock, unfocusedRate: true });
    store.info("Away");
    advance(3000);
    expect(store.snapshot()).toHaveLength(1);
    advance(3000);
    expect(store.snapshot()).toHaveLength(0);
  });

  it("reconfigures a live store without losing elapsed time", () => {
    const { clock, advance } = manualClock();
    const store = createToastStore({ clock });
    const id = store.info("Shared");
    advance(1500);
    store.configure({ unfocusedRate: 0.25, duration: 1000 });
    expect(store.rate()).toBe(0.25);
    expect(store.progress(id)).toBeCloseTo(0.5);
    advance(5999);
    expect(store.snapshot()).toHaveLength(1);
    advance(1);
    expect(store.snapshot()).toHaveLength(0);
    store.info("Shorter");
    expect(store.snapshot()[0]?.duration).toBe(1000);
  });

  it("trims immediately when the limit shrinks", () => {
    const { clock } = manualClock();
    const store = createToastStore({ clock });
    for (const message of ["A", "B", "C"]) store.info(message);
    store.configure({ limit: 1 });
    expect(store.snapshot().map((toast) => toast.message)).toEqual(["C"]);
  });
});

describe("toast rendering", () => {
  it("announces errors assertively and everything else politely", () => {
    expect(toastAnnouncement("error")).toEqual({ role: "alert", "aria-live": "assertive" });
    expect(toastAnnouncement("success")).toEqual({ role: "status", "aria-live": "polite" });
  });

  it("renders a card with title, actions, stamp and bar", () => {
    const store = createToastStore({ clock: manualClock().clock });
    const id = store.push("Body", { kind: "warning", title: "Heads up", actions: [{ label: "Undo", onClick: () => {}, primary: true }] });
    const toast = store.snapshot().find((entry) => entry.id === id)!;
    const node = (ToastCard as unknown as { setup: Function }).setup(
      { toast, store, progress: 0.25, closeLabel: "Close", timestamp: true },
      { attrs: {}, emit: () => {}, slots: {} },
    )();
    expect(node.props.class).toBe("pk-toast pk-toast--warning");
    expect(node.props.role).toBe("status");
    const children = node.children as Array<{ props?: Record<string, unknown>; children?: unknown } | null>;
    expect(children[0]?.props?.["aria-label"]).toBe("Close");
    expect(children[1]?.children).toBe("Heads up");
    expect(children.at(-1)?.props?.style).toEqual({ transform: "scaleX(0.25)" });
  });

  it("omits the progress bar for sticky toasts", () => {
    const store = createToastStore({ clock: manualClock().clock });
    store.push("Sticky", { duration: 0 });
    const node = (ToastCard as unknown as { setup: Function }).setup(
      { toast: store.snapshot()[0], store, progress: 1, closeLabel: "Close", timestamp: false },
      { attrs: {}, emit: () => {}, slots: {} },
    )();
    expect((node.children as unknown[]).filter(Boolean)).toHaveLength(2);
    expect(node.props["data-sticky"]).toBe("");
  });

  it("exposes host placement and theme props", () => {
    const props = (ToastHost as unknown as { props: Record<string, { default?: unknown }> }).props;
    expect(props.placement?.default).toBe("bottom-end");
    expect(props.theme?.default).toBe("system");
    expect(props.to?.default).toBe("body");
  });

  it("ships light, dark and reduced-motion styles", async () => {
    const css = await readFile(new URL("../styles/toast/src/toast.css", import.meta.url), "utf8");
    expect(css).toContain('[data-pk-toast-theme="light"]');
    expect(css).toContain("prefers-reduced-motion");
    expect(css).toContain(".pk-toast-leave-active");
  });
});
