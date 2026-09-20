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

function faviconUrl(address: string | undefined): string | null {
  const url = parseWebAddress(address);
  return url ? new URL("/favicon.ico", url.origin).href : null;
}

export function providerIconUrls(provider: Pick<ModelAuthProvider, "id" | "api" | "website" | "iconUrl">): string[] {
  const directIcon = parseWebAddress(provider.iconUrl);
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
