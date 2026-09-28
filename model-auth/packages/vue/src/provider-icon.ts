import type { ModelAuthProvider } from "./types";

const KNOWN_PROVIDER_WEBSITES: Record<string, string> = {
  anthropic: "https://www.anthropic.com",
  deepseek: "https://www.deepseek.com",
  gemini: "https://ai.google.dev",
  "github-copilot": "https://github.com/features/copilot",
  google: "https://ai.google.dev",
  grok: "https://x.ai",
  kimi: "https://www.kimi.com/code",
  "kimi-coding": "https://www.kimi.com/code",
  "kimi-for-coding": "https://www.kimi.com/code",
  moonshotai: "https://www.kimi.com/code",
  ollama: "https://ollama.com",
  "ollama-cloud": "https://ollama.com",
  openai: "https://openai.com",
  "openai-codex": "https://openai.com",
  openrouter: "https://openrouter.ai",
  "tencent-tokenhub": "https://copilot.tencent.com",
  trae: "https://www.trae.ai",
  traecode: "https://www.trae.ai",
  workbuddy: "https://copilot.tencent.com",
  xai: "https://x.ai",
  zhipuai: "https://z.ai",
};

function parseWebAddress(value: string | undefined): URL | null {
  if (!value?.trim()) return null;
  try {
    const url = new URL(value.trim());
    return url.protocol === "http:" || url.protocol === "https:" ? url : null;
  } catch {
    return null;
  }
}

function parseIconAddress(value: string | undefined, baseUrl?: string): URL | null {
  if (!value?.trim()) return null;
  try {
    const url = new URL(value.trim(), baseUrl);
    if (url.protocol === "http:" || url.protocol === "https:") return url;
    if (!baseUrl) return null;
    const base = new URL(baseUrl);
    return base.protocol !== "file:" && base.host !== "" && url.protocol === base.protocol && url.host === base.host ? url : null;
  } catch {
    return null;
  }
}

function faviconUrl(address: string | undefined): string | null {
  const url = parseWebAddress(address);
  return url ? new URL("/favicon.ico", url.origin).href : null;
}

export function providerIconUrls(provider: Pick<ModelAuthProvider, "id" | "api" | "website" | "iconUrl">, baseUrl = typeof document === "undefined" ? undefined : document.baseURI): string[] {
  const directIcon = parseIconAddress(provider.iconUrl, baseUrl);
  return [...new Set([
    directIcon?.href ?? null,
    faviconUrl(provider.api),
    faviconUrl(provider.website),
    faviconUrl(KNOWN_PROVIDER_WEBSITES[provider.id.trim().toLowerCase()]),
  ].filter((url): url is string => Boolean(url)))];
}

export function providerIconUrl(provider: Pick<ModelAuthProvider, "id" | "api" | "website" | "iconUrl">): string | null {
  return providerIconUrls(provider)[0] ?? null;
}
