import type { ModelAuthProvider } from "./types";

const KNOWN_PROVIDER_WEBSITES: Record<string, string> = {
  anthropic: "https://www.anthropic.com",
  deepseek: "https://www.deepseek.com",
  gemini: "https://ai.google.dev",
  google: "https://ai.google.dev",
  grok: "https://x.ai",
  ollama: "https://ollama.com",
  openai: "https://openai.com",
  "openai-codex": "https://openai.com",
  trae: "https://www.trae.ai",
  traecode: "https://www.trae.ai",
  workbuddy: "https://copilot.tencent.com",
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

export function providerIconUrl(provider: Pick<ModelAuthProvider, "id" | "api" | "website" | "iconUrl">): string | null {
  const directIcon = parseWebAddress(provider.iconUrl);
  if (directIcon) return directIcon.href;
  return faviconUrl(provider.api)
    ?? faviconUrl(provider.website)
    ?? faviconUrl(KNOWN_PROVIDER_WEBSITES[provider.id.trim().toLowerCase()]);
}
