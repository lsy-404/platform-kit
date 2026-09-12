import type { ProviderAuthInteraction, ProviderAuthNotice, ProviderAuthPrompt } from "@model-auth/core";

export const PI_OAUTH_PROVIDER_IDS = ["github-copilot", "kimi-coding", "openrouter"] as const;
export type PiOAuthProviderId = typeof PI_OAUTH_PROVIDER_IDS[number];
export interface PiOAuthCredential extends Readonly<Record<string, unknown>> { readonly type: "oauth"; readonly access: string; readonly refresh: string; readonly expires: number; }
export interface PiOAuthCredentialEnvelope { readonly providerId: PiOAuthProviderId; readonly credential: PiOAuthCredential; }
export interface PiRequestAuth { readonly apiKey?: string; readonly headers?: Readonly<Record<string, string | null>>; readonly baseUrl?: string; }
export type PiAuthPrompt = ProviderAuthPrompt & { readonly signal?: AbortSignal };
export type PiAuthNotice = { readonly type: "info"; readonly message: string; readonly links?: readonly { readonly url: string; readonly label?: string }[] } | Exclude<ProviderAuthNotice, { readonly type: "message" }>;
export interface PiOAuthAuth {
  readonly name: string; readonly isSubscription?: boolean; readonly loginLabel?: string;
  login(interaction: { readonly signal: AbortSignal; readonly prompt: (prompt: PiAuthPrompt) => Promise<string>; readonly notify: (notice: PiAuthNotice) => void }): Promise<PiOAuthCredential>;
  refresh(credential: PiOAuthCredential, signal: AbortSignal): Promise<PiOAuthCredential>;
  toAuth(credential: PiOAuthCredential): Promise<PiRequestAuth>;
}
export interface PiOAuthProvider { readonly id: string; readonly name?: string; readonly auth?: { readonly oauth?: PiOAuthAuth }; }
export interface PiOAuthProviderDescriptor { readonly providerId: PiOAuthProviderId; readonly name: string; readonly loginLabel?: string; readonly isSubscription?: boolean; }
export interface PiOAuthAdapter {
  readonly descriptor: PiOAuthProviderDescriptor;
  authorize(interaction: ProviderAuthInteraction): Promise<PiOAuthCredentialEnvelope>;
  refresh(credential: PiOAuthCredentialEnvelope, signal?: AbortSignal): Promise<PiOAuthCredentialEnvelope>;
  toAuth(credential: PiOAuthCredentialEnvelope): Promise<PiRequestAuth>;
}
export class PiOAuthBridgeError extends Error { public constructor(message: string) { super(message); this.name = "PiOAuthBridgeError"; } }

export function listPiOAuthProviders(providers: Iterable<PiOAuthProvider>): readonly PiOAuthProviderDescriptor[] { return [...providers].flatMap(provider => { try { return [descriptor(provider)]; } catch { return []; } }); }
export function discoverPiOAuthProvider(providers: Iterable<PiOAuthProvider>, providerId: PiOAuthProviderId): PiOAuthProviderDescriptor | null {
  for (const provider of providers) if (provider.id === providerId) { try { return descriptor(provider); } catch { return null; } }
  return null;
}
export function createPiOAuthAdapter(provider: PiOAuthProvider): PiOAuthAdapter {
  const bridgeDescriptor = descriptor(provider), oauth = provider.auth!.oauth!;
  return {
    descriptor: bridgeDescriptor,
    async authorize(interaction) {
      if (interaction.providerId !== bridgeDescriptor.providerId || interaction.authType !== "oauth" || !text(interaction.loginId)) throw new PiOAuthBridgeError("Pi OAuth interaction is incompatible with its provider.");
      const signal = interaction.signal ?? new AbortController().signal;
      active(signal);
      return envelope(bridgeDescriptor.providerId, await oauth.login({ signal, notify: notice => interaction.notify(noticeFromPi(notice)), prompt: prompt => promptFromPi(interaction, prompt) }));
    },
    async refresh(value, signal = new AbortController().signal) { active(signal); return envelope(bridgeDescriptor.providerId, await oauth.refresh(envelopeCredential(value, bridgeDescriptor.providerId), signal)); },
    async toAuth(value) { return requestAuth(await oauth.toAuth(envelopeCredential(value, bridgeDescriptor.providerId))); },
  };
}
function descriptor(provider: PiOAuthProvider): PiOAuthProviderDescriptor {
  if (!(PI_OAUTH_PROVIDER_IDS as readonly string[]).includes(provider.id)) throw new PiOAuthBridgeError("Pi OAuth provider is unsupported.");
  const oauth = provider.auth?.oauth;
  if (!oauth || !text(oauth.name) || typeof oauth.login !== "function" || typeof oauth.refresh !== "function" || typeof oauth.toAuth !== "function") throw new PiOAuthBridgeError("Pi OAuth provider is unavailable.");
  const loginLabel = text(oauth.loginLabel);
  return { providerId: provider.id as PiOAuthProviderId, name: oauth.name.trim(), ...(loginLabel ? { loginLabel } : {}), ...(typeof oauth.isSubscription === "boolean" ? { isSubscription: oauth.isSubscription } : {}) };
}
function noticeFromPi(notice: PiAuthNotice): ProviderAuthNotice {
  if (notice.type !== "info") return notice;
  const links = notice.links?.flatMap(link => text(link.url) ? [{ url: link.url.trim(), label: text(link.label) ?? link.url.trim() }] : []);
  return { type: "info", message: requiredText(notice.message), ...(links?.length ? { links } : {}) };
}
function promptFromPi(interaction: ProviderAuthInteraction, prompt: PiAuthPrompt): Promise<string> {
  const signal = prompt.signal ? AbortSignal.any([interaction.signal ?? new AbortController().signal, prompt.signal]) : interaction.signal ?? new AbortController().signal;
  active(signal);
  const shared: ProviderAuthPrompt = prompt.type === "select" ? { type: "select", message: requiredText(prompt.message), options: prompt.options } : (() => {
    const placeholder = text(prompt.placeholder);
    return { type: prompt.type, message: requiredText(prompt.message), ...(placeholder ? { placeholder } : {}) };
  })();
  return abortable(interaction.prompt(shared), signal);
}
function credential(value: unknown): PiOAuthCredential {
  if (!record(value) || value.type !== "oauth" || !text(value.access) || !text(value.refresh) || typeof value.expires !== "number" || !Number.isFinite(value.expires) || value.expires <= 0) throw new PiOAuthBridgeError("Pi OAuth credential is invalid.");
  const access = text(value.access)!, refresh = text(value.refresh)!;
  return { ...value, type: "oauth", access, refresh, expires: value.expires };
}
function envelope(providerId: PiOAuthProviderId, value: unknown): PiOAuthCredentialEnvelope { return { providerId, credential: credential(value) }; }
function envelopeCredential(value: unknown, providerId: PiOAuthProviderId): PiOAuthCredential {
  if (!record(value) || value.providerId !== providerId || !Object.hasOwn(value, "credential")) throw new PiOAuthBridgeError("Pi OAuth credential belongs to another provider.");
  return credential(value.credential);
}
function requestAuth(value: unknown): PiRequestAuth {
  if (!record(value)) throw new PiOAuthBridgeError("Pi OAuth request auth is invalid.");
  const apiKey = value.apiKey === undefined ? undefined : text(value.apiKey), baseUrl = value.baseUrl === undefined ? undefined : text(value.baseUrl);
  if (value.apiKey !== undefined && !apiKey || value.baseUrl !== undefined && !baseUrl) throw new PiOAuthBridgeError("Pi OAuth request auth is invalid.");
  let headers: Record<string, string | null> | undefined;
  if (value.headers !== undefined) { if (!record(value.headers)) throw new PiOAuthBridgeError("Pi OAuth request headers are invalid."); headers = {}; for (const [key, header] of Object.entries(value.headers)) { if (!text(key) || typeof header !== "string" && header !== null) throw new PiOAuthBridgeError("Pi OAuth request headers are invalid."); headers[key] = header; } }
  return { ...(apiKey ? { apiKey } : {}), ...(headers ? { headers } : {}), ...(baseUrl ? { baseUrl } : {}) };
}
function abortable<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => { const abort = () => reject(new PiOAuthBridgeError("Pi OAuth prompt was cancelled.")); signal.addEventListener("abort", abort, { once: true }); void operation.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort)); });
}
function active(signal: AbortSignal): void { if (signal.aborted) throw new PiOAuthBridgeError("Pi OAuth operation was cancelled."); }
function record(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function text(value: unknown): string | undefined { return typeof value === "string" && value.trim() ? value.trim() : undefined; }
function requiredText(value: unknown): string { const result = text(value); if (!result) throw new PiOAuthBridgeError("Pi OAuth interaction is invalid."); return result; }
