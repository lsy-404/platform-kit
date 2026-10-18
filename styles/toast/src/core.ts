export type ToastKind = "info" | "success" | "warning" | "error";
export type ToastPlacement =
  | "bottom-end"
  | "bottom-start"
  | "bottom-center"
  | "top-end"
  | "top-start"
  | "top-center";
export type ToastTheme = "light" | "dark" | "system";

export interface ToastAction {
  label: string;
  onClick: () => void;
  primary?: boolean;
  /** Keep the toast open after the action runs. */
  keepOpen?: boolean;
}

export interface ToastOptions {
  title?: string;
  kind?: ToastKind;
  /** Display time in ms at the idle rate; 0 keeps the toast until dismissed. */
  duration?: number;
  actions?: readonly ToastAction[];
}

export interface Toast {
  readonly id: number;
  readonly createdAt: number;
  readonly message: string;
  readonly title?: string;
  readonly kind: ToastKind;
  readonly duration: number;
  readonly actions: readonly ToastAction[];
}

/** What the viewer is doing; the store turns it into a clock rate. */
export interface ToastAttention {
  /** Page is visible and the window has focus. */
  focused: boolean;
  /** Pointer or keyboard focus is inside the toast stack. */
  engaged: boolean;
}

export interface ToastClock {
  now(): number;
  setTimeout(callback: () => void, delay: number): unknown;
  clearTimeout(handle: unknown): void;
}

export interface ToastSettings {
  /** Default display time; errors default to `errorDuration`. */
  duration?: number;
  errorDuration?: number;
  /** Oldest timed toasts are dropped beyond this count. */
  limit?: number;
  /**
   * Clock rate while the window is unfocused or hidden: `false` keeps 1,
   * `true` uses 0.5, a number sets the rate. Focused windows always run at 1.
   */
  unfocusedRate?: boolean | number;
}

export interface ToastStoreOptions extends ToastSettings {
  /** Replaces the default attention policy, including `unfocusedRate`. */
  rate?: (attention: ToastAttention) => number;
  clock?: ToastClock;
}

export type ToastPatch = Partial<Pick<Toast, "message" | "title" | "kind" | "actions">>;

export interface ToastStore {
  /** Current toasts, oldest first; a new array after every change. */
  snapshot(): readonly Toast[];
  subscribe(listener: () => void): () => void;
  push(message: string, options?: ToastOptions): number;
  update(id: number, patch: ToastPatch): void;
  dismiss(id: number): void;
  clear(): void;
  /** Remaining share of display time in [0, 1]; 1 for sticky toasts. */
  progress(id: number): number;
  /** Clock rate currently applied to all timed toasts. */
  rate(): number;
  setAttention(patch: Partial<ToastAttention>): void;
  /** Changes defaults for later toasts and the unfocused rate for all timed ones. */
  configure(settings: ToastSettings): void;
  runAction(id: number, action: ToastAction): void;
  info(message: string, title?: string): number;
  success(message: string, title?: string): number;
  warning(message: string, title?: string): number;
  error(message: string, title?: string): number;
  destroy(): void;
}

interface Entry {
  toast: Toast;
  /** Effective elapsed time at `markedAt`. */
  elapsed: number;
  markedAt: number;
  timer: unknown;
}

const systemClock: ToastClock = {
  now: () => Date.now(),
  setTimeout: (callback, delay) => globalThis.setTimeout(callback, delay),
  clearTimeout: (handle) => globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>),
};

export function unfocusedRateOf(setting: boolean | number | undefined): number {
  if (setting === true) return 0.5;
  if (typeof setting === "number" && Number.isFinite(setting) && setting >= 0) return setting;
  return 1;
}

/**
 * Engaged stacks pause. With `unfocusedRate` enabled, toasts left in a
 * background window run slower so they are still there when the viewer returns.
 */
export function defaultToastRate(attention: ToastAttention, unfocusedRate: boolean | number = false): number {
  if (attention.engaged) return 0;
  return attention.focused ? 1 : unfocusedRateOf(unfocusedRate);
}

export function createToastStore(options: ToastStoreOptions = {}): ToastStore {
  const clock = options.clock ?? systemClock;
  const settings: Required<ToastSettings> = {
    duration: options.duration ?? 3000,
    errorDuration: options.errorDuration ?? 5000,
    limit: Math.max(1, options.limit ?? 5),
    unfocusedRate: options.unfocusedRate ?? false,
  };
  const rateOf = options.rate ?? ((state: ToastAttention) => defaultToastRate(state, settings.unfocusedRate));
  const listeners = new Set<() => void>();
  let entries: Entry[] = [];
  let view: readonly Toast[] = [];
  let attention: ToastAttention = { focused: false, engaged: false };
  let currentRate = rateOf(attention);
  let nextId = 1;

  const emit = () => {
    view = entries.map((entry) => entry.toast);
    for (const listener of [...listeners]) listener();
  };

  const elapsedOf = (entry: Entry) =>
    entry.elapsed + (clock.now() - entry.markedAt) * currentRate;

  const unschedule = (entry: Entry) => {
    if (entry.timer !== undefined) clock.clearTimeout(entry.timer);
    entry.timer = undefined;
  };

  const schedule = (entry: Entry) => {
    unschedule(entry);
    if (entry.toast.duration <= 0 || currentRate <= 0) return;
    const remaining = entry.toast.duration - elapsedOf(entry);
    if (remaining <= 0) {
      dismiss(entry.toast.id);
      return;
    }
    const id = entry.toast.id;
    entry.timer = clock.setTimeout(() => dismiss(id), Math.max(1, remaining / currentRate));
  };

  // The newest toast always survives; older timed toasts go before sticky ones.
  const trim = () => {
    while (entries.length > settings.limit) {
      const older = entries.slice(0, -1);
      const victim = older.find((entry) => entry.toast.duration > 0) ?? older[0];
      if (!victim) return;
      unschedule(victim);
      entries = entries.filter((entry) => entry !== victim);
    }
  };

  function push(message: string, input: ToastOptions = {}): number {
    const kind = input.kind ?? "info";
    const now = clock.now();
    const entry: Entry = {
      toast: {
        id: nextId++,
        createdAt: now,
        message,
        kind,
        duration: input.duration ?? (kind === "error" ? settings.errorDuration : settings.duration),
        actions: input.actions ?? [],
        ...(input.title === undefined ? {} : { title: input.title }),
      },
      elapsed: 0,
      markedAt: now,
      timer: undefined,
    };
    entries = [...entries, entry];
    trim();
    schedule(entry);
    emit();
    return entry.toast.id;
  }

  function update(id: number, patch: ToastPatch): void {
    const entry = entries.find((candidate) => candidate.toast.id === id);
    if (!entry) return;
    entry.toast = { ...entry.toast, ...patch };
    emit();
  }

  function dismiss(id: number): void {
    const entry = entries.find((candidate) => candidate.toast.id === id);
    if (!entry) return;
    unschedule(entry);
    entries = entries.filter((candidate) => candidate !== entry);
    emit();
  }

  function clear(): void {
    if (!entries.length) return;
    for (const entry of entries) unschedule(entry);
    entries = [];
    emit();
  }

  function setAttention(patch: Partial<ToastAttention>): void {
    attention = { ...attention, ...patch };
    applyRate();
  }

  function configure(patch: ToastSettings): void {
    if (patch.duration !== undefined) settings.duration = patch.duration;
    if (patch.errorDuration !== undefined) settings.errorDuration = patch.errorDuration;
    if (patch.unfocusedRate !== undefined) settings.unfocusedRate = patch.unfocusedRate;
    if (patch.limit !== undefined) {
      settings.limit = Math.max(1, patch.limit);
      const before = entries.length;
      trim();
      if (entries.length !== before) emit();
    }
    applyRate();
  }

  // A rate change banks each toast's elapsed time before the new rate applies.
  function applyRate(): void {
    const rate = Math.max(0, rateOf(attention));
    if (rate === currentRate) return;
    const now = clock.now();
    for (const entry of entries) {
      entry.elapsed = elapsedOf(entry);
      entry.markedAt = now;
    }
    currentRate = rate;
    for (const entry of [...entries]) schedule(entry);
  }

  function progress(id: number): number {
    const entry = entries.find((candidate) => candidate.toast.id === id);
    if (!entry || entry.toast.duration <= 0) return 1;
    return Math.min(1, Math.max(0, 1 - elapsedOf(entry) / entry.toast.duration));
  }

  function runAction(id: number, action: ToastAction): void {
    try {
      action.onClick();
    } finally {
      if (!action.keepOpen) dismiss(id);
    }
  }

  return {
    snapshot: () => view,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    push,
    update,
    dismiss,
    clear,
    progress,
    rate: () => currentRate,
    setAttention,
    configure,
    runAction,
    info: (message, title) => push(message, { kind: "info", ...(title === undefined ? {} : { title }) }),
    success: (message, title) => push(message, { kind: "success", ...(title === undefined ? {} : { title }) }),
    warning: (message, title) => push(message, { kind: "warning", ...(title === undefined ? {} : { title }) }),
    error: (message, title) => push(message, { kind: "error", ...(title === undefined ? {} : { title }) }),
    destroy() {
      for (const entry of entries) unschedule(entry);
      entries = [];
      view = [];
      listeners.clear();
    },
  };
}

/** Feeds window focus and page visibility into a store; returns the cleanup. */
export function observeWindowAttention(store: ToastStore, target: Window = window): () => void {
  const doc = target.document;
  const sync = () =>
    store.setAttention({ focused: doc.visibilityState === "visible" && doc.hasFocus() });
  const onBlur = () => store.setAttention({ focused: false });
  sync();
  doc.addEventListener("visibilitychange", sync);
  target.addEventListener("focus", sync);
  target.addEventListener("blur", onBlur);
  return () => {
    doc.removeEventListener("visibilitychange", sync);
    target.removeEventListener("focus", sync);
    target.removeEventListener("blur", onBlur);
  };
}

/** Live-region semantics per kind: errors interrupt, everything else waits. */
export function toastAnnouncement(kind: ToastKind): { role: "alert" | "status"; "aria-live": "assertive" | "polite" } {
  return kind === "error"
    ? { role: "alert", "aria-live": "assertive" }
    : { role: "status", "aria-live": "polite" };
}
