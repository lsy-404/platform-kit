import type { CredentialUsageWindow, CredentialUsageWindowStatus, ProviderCredential } from "./types";

export function windowRemaining(w: CredentialUsageWindow): number | null {
  return w.remainingPercent ?? (w.usedPercent === null ? null : Math.max(0, 100 - w.usedPercent));
}

function minOf(values: Array<number | null>): number | null {
  const present = values.filter((value): value is number => value !== null);
  return present.length ? Math.min(...present) : null;
}

export function credentialRemaining(c: ProviderCredential): number | null {
  return minOf((c.usage?.windows ?? []).map(windowRemaining));
}

export function lowestRemaining(cs: ProviderCredential[]): number | null {
  return minOf(cs.filter(c => c.enabled).map(credentialRemaining));
}

export function credentialReady(c: ProviderCredential): boolean {
  return c.enabled && c.healthy && !c.cooldownUntilUtc;
}

export function formatCooldown(utc: string): string {
  const date = new Date(utc);
  if (Number.isNaN(date.getTime())) return utc;
  return date.toDateString() === new Date().toDateString() ? date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : date.toLocaleString();
}

export function fill(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) => key in values ? String(values[key]) : match);
}

const HOUR = 3600;
const DAY = 86400;
const KIND_LABELS = { session: "5h", daily: "1d", weekly: "7d", monthly: "30d" } as const;

/** Short duration label such as "5h" or "7d". */
export function windowShortLabel(w: Pick<CredentialUsageWindow, "label" | "kind" | "windowSeconds">): string {
  const seconds = w.windowSeconds;
  if (seconds !== undefined && seconds > 0) {
    if (seconds % DAY === 0) return `${seconds / DAY}d`;
    if (seconds % HOUR === 0) return `${seconds / HOUR}h`;
    return `${Math.max(1, Math.round(seconds / 60))}m`;
  }
  return w.kind ? KIND_LABELS[w.kind] : w.label;
}

/** Time until reset as "3d 4h", "2h 15m" or "45m"; null when there is no reset time. */
export function resetCountdown(resetAt: number | null | undefined, now: number = Date.now()): string | null {
  if (resetAt === null || resetAt === undefined) return null;
  const minutes = Math.max(0, Math.floor((resetAt - now) / 60000));
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  const rest = minutes % 60;
  if (days > 0) return hours > 0 ? `${days}d ${hours}h` : `${days}d`;
  if (hours > 0) return rest > 0 ? `${hours}h ${rest}m` : `${hours}h`;
  return `${rest}m`;
}

export type UsageTint = "unknown" | "ok" | "warn" | "danger" | "exhausted";

/** Tint thresholds: below 50 ok, below 75 warn, otherwise danger; exhausted is separate. */
export function usageTint(usedPercent: number | null, status?: CredentialUsageWindowStatus): UsageTint {
  if (status === "exhausted") return "exhausted";
  if (usedPercent === null) return "unknown";
  return usedPercent < 50 ? "ok" : usedPercent < 75 ? "warn" : "danger";
}

/** The n windows with the least remaining quota; exhausted first, unknown last. */
export function tightestWindows(windows: readonly CredentialUsageWindow[], n: number): CredentialUsageWindow[] {
  const rank = (w: CredentialUsageWindow): number => w.status === "exhausted" ? -1 : (windowRemaining(w) ?? Infinity);
  return windows.map((window, index) => ({ window, index }))
    .sort((a, b) => rank(a.window) - rank(b.window) || a.index - b.index)
    .slice(0, Math.max(0, n))
    .map(({ window }) => window);
}
