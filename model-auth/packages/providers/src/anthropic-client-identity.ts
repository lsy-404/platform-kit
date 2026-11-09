export interface AnthropicClientIdentity {
  readonly clientVersion: string;
  readonly entrypoint?: string;
  readonly sdkVersion?: string;
  readonly clientApp?: string;
}

const VERSION = /^\d{1,9}(?:\.\d{1,9}){1,3}(?:-[A-Za-z0-9.-]{1,40})?$/;
const TOKEN = /^[A-Za-z0-9._-]{1,80}$/;
const CLIENT_APP = /^[A-Za-z0-9._/-]{1,80}$/;

export function anthropicIdentityHeaders(identity: AnthropicClientIdentity): Record<string, string> {
  const { clientVersion, sdkVersion, clientApp, entrypoint = "cli" } = identity;
  if (!VERSION.test(clientVersion) || (sdkVersion !== undefined && !VERSION.test(sdkVersion)) || !TOKEN.test(entrypoint) || (clientApp !== undefined && !CLIENT_APP.test(clientApp))) throw new TypeError("Invalid Anthropic client identity.");
  return { "user-agent": `claude-cli/${clientVersion} (external, ${entrypoint}${sdkVersion ? `, agent-sdk/${sdkVersion}` : ""}${clientApp ? `, client-app/${clientApp}` : ""})`,
    "x-app": "cli", ...(clientApp ? { "x-client-app": clientApp } : {}) };
}
