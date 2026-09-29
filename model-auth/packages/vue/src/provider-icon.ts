import type { ModelAuthProvider } from "./types";

// Host icons must be http(s) or same-origin with the document, never data: or foreign app schemes.
export function providerIconUrl(provider: Pick<ModelAuthProvider, "iconUrl">, baseUrl = typeof document === "undefined" ? undefined : document.baseURI): string | null {
  const value = provider.iconUrl?.trim();
  if (!value) return null;
  try {
    const url = new URL(value, baseUrl);
    if (url.protocol === "http:" || url.protocol === "https:") return url.href;
    if (!baseUrl) return null;
    const base = new URL(baseUrl);
    return base.protocol !== "file:" && base.host !== "" && url.protocol === base.protocol && url.host === base.host ? url.href : null;
  } catch {
    return null;
  }
}
