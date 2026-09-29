import type { AuthMethod, ModelAuthProvider } from "./types";

export function connectionModels(provider: ModelAuthProvider, method: AuthMethod): string[] {
  const methodModels = method === "oauth" ? provider.oauthModels : provider.apiKeyModels;
  const credentials = (method === "oauth" ? provider.oauthCredentials : provider.apiKeyCredentials) ?? [];
  const models = [...(methodModels?.length ? methodModels : provider.models), ...credentials.flatMap(credential => credential.models ?? [])];
  return [...new Set(models.filter(model => model.trim()))];
}
