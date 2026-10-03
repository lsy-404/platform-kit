import type { CredentialUsageWindow, ProviderCredential } from "./types";

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

export function fill(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) => key in values ? String(values[key]) : match);
}
