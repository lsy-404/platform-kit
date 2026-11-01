import { authorizeAntigravity, ANTIGRAVITY_CLIENT_ID, ANTIGRAVITY_CLIENT_SECRET, ANTIGRAVITY_REDIRECT_URI, ANTIGRAVITY_LOAD_ENDPOINTS, buildAntigravityHarnessBootstrapHeaders, buildAntigravityLoadCodeAssistMetadata, getPublicModelDefinitions } from '@cortexkit/antigravity-auth-core';
import type { Api, Model, OAuthCredential, Provider, SimpleStreamOptions } from '@earendil-works/pi-ai';
import { streamCortexKitAntigravity } from './antigravity/stream.js';

const id = 'google-antigravity';
const baseUrl = 'https://cloudcode-pa.googleapis.com';
type TokenResponse = { access_token: string; refresh_token?: string; expires_in: number };

export function createAntigravityProvider(options: { fetchImpl?: typeof fetch } = {}): Provider {
  const fetchImpl = options.fetchImpl ?? fetch;
  async function token(body: URLSearchParams, signal: AbortSignal): Promise<TokenResponse> {
    const response = await fetchImpl('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body, signal });
    if (!response.ok) throw new Error('Antigravity OAuth token exchange failed (' + response.status + ')');
    const result = await response.json() as TokenResponse;
    if (!result.access_token || !Number.isFinite(result.expires_in)) throw new Error('Invalid Antigravity OAuth response');
    return result;
  }
  async function project(access: string, signal: AbortSignal): Promise<string> {
    const headers = buildAntigravityHarnessBootstrapHeaders(access);
    for (const endpoint of ANTIGRAVITY_LOAD_ENDPOINTS) {
      signal.throwIfAborted();
      try {
        const response = await fetchImpl(endpoint + '/v1internal:loadCodeAssist', { method: 'POST', headers, body: JSON.stringify({ metadata: buildAntigravityLoadCodeAssistMetadata() }), signal });
        if (!response.ok) continue;
        const data = await response.json() as { cloudaicompanionProject?: string | { id?: string }; allowedTiers?: { id: string; isDefault?: boolean }[] };
        const found = typeof data.cloudaicompanionProject === 'string' ? data.cloudaicompanionProject : data.cloudaicompanionProject?.id;
        if (found) return found;
        const tierId = data.allowedTiers?.find(t => t.isDefault)?.id ?? data.allowedTiers?.[0]?.id ?? 'free-tier';
        for (let attempt = 0; attempt < 10; attempt++) {
          const onboard = await fetchImpl(endpoint + '/v1internal:onboardUser', { method: 'POST', headers, body: JSON.stringify({ tierId }), signal });
          if (!onboard.ok) break;
          const result = await onboard.json() as { done?: boolean; response?: { cloudaicompanionProject?: { id?: string } } };
          if (result.done && result.response?.cloudaicompanionProject?.id) return result.response.cloudaicompanionProject.id;
          await new Promise<void>((resolve, reject) => { const timer = setTimeout(() => { signal.removeEventListener('abort', cancel); resolve(); }, 5000); const cancel = () => { clearTimeout(timer); reject(signal.reason); }; signal.addEventListener('abort', cancel, { once: true }); if (signal.aborted) cancel(); });
        }
      } catch (error) { signal.throwIfAborted(); }
    }
    throw new Error('Unable to discover Antigravity project');
  }
  const models: Model<Api>[] = Object.values(getPublicModelDefinitions()).filter(m => !m.modalities.output.includes('image')).map(m => ({ id: m.id, name: m.name, provider: id, api: 'google-generative-ai', baseUrl, reasoning: m.reasoning, input: ['text', 'image'], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: m.limit.context, maxTokens: m.limit.output }));
  const send = (model: Model<Api>, context: Parameters<Provider['streamSimple']>[1], streamOptions?: SimpleStreamOptions) => streamCortexKitAntigravity(model, context, { ...streamOptions, fetch: streamOptions?.fetch ?? fetchImpl });
  return {
    id, name: 'Google Antigravity', baseUrl, getModels: () => models,
    auth: { oauth: {
      name: 'Google Antigravity', isSubscription: true,
      async login(interaction) {
        const auth = await authorizeAntigravity();
        const state = new URL(auth.url).searchParams.get('state')!;
        interaction.notify({ type: 'auth_url', url: auth.url });
        const answer = (await interaction.prompt({ type: 'manual_code', message: 'Paste the OAuth callback URL or authorization code' })).trim();
        interaction.signal.throwIfAborted();
        let code = answer;
        try { const callback = new URL(answer); code = callback.searchParams.get('code') ?? ''; if (callback.searchParams.get('state') !== state) throw new Error('OAuth state mismatch'); } catch (error) { if (error instanceof TypeError) { code = answer; } else { throw error; } }
        if (!code) throw new Error('Missing OAuth authorization code');
        const result = await token(new URLSearchParams({ client_id: ANTIGRAVITY_CLIENT_ID, client_secret: ANTIGRAVITY_CLIENT_SECRET, code, grant_type: 'authorization_code', redirect_uri: ANTIGRAVITY_REDIRECT_URI, code_verifier: auth.verifier }), interaction.signal);
        if (!result.refresh_token) throw new Error('Missing Antigravity refresh token');
        const projectId = await project(result.access_token, interaction.signal);
        return { type: 'oauth', access: result.access_token, refresh: result.refresh_token, expires: Date.now() + result.expires_in * 1000 - 60000, projectId };
      },
      async refresh(credential, signal) {
        const result = await token(new URLSearchParams({ client_id: ANTIGRAVITY_CLIENT_ID, client_secret: ANTIGRAVITY_CLIENT_SECRET, refresh_token: credential.refresh, grant_type: 'refresh_token' }), signal);
        return { ...credential, access: result.access_token, refresh: result.refresh_token ?? credential.refresh, expires: Date.now() + result.expires_in * 1000 - 60000 };
      },
      async toAuth(credential: OAuthCredential) {
        if (typeof credential.projectId !== 'string' || !credential.projectId) throw new Error('Missing Antigravity project');
        return { apiKey: JSON.stringify({ access: credential.access, projectId: credential.projectId }) };
      },
    } },
    stream: (model, context, streamOptions) => send(model, context, streamOptions as SimpleStreamOptions), streamSimple: send,
  };
}
