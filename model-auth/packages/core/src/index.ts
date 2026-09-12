export const MODEL_AUTH_VERSION = "0.6.0";

export type AuthMethod = "oauth" | "api-key";
export type ProviderAuthType = "oauth" | "api_key";
export type CredentialHealth = "healthy" | "cooling-down" | "permanently-failed";
export type RouteStrategy = "round-robin" | "weighted-round-robin" | "failover";

export type ProviderAuthPrompt =
  | { readonly type: "text" | "secret" | "manual_code"; readonly message: string; readonly placeholder?: string }
  | { readonly type: "select"; readonly message: string; readonly options: readonly { readonly id: string; readonly label: string; readonly description?: string }[] };

export type ProviderAuthNotice =
  | { readonly type: "info" | "message"; readonly message: string; readonly links?: readonly { readonly label: string; readonly url: string }[] }
  | { readonly type: "auth_url"; readonly url: string; readonly instructions?: string }
  | { readonly type: "device_code"; readonly userCode: string; readonly verificationUri: string; readonly intervalSeconds?: number; readonly expiresInSeconds?: number }
  | { readonly type: "progress"; readonly message: string };

export type ProviderAuthEvent =
  | { readonly type: "provider-auth-prompt"; readonly loginId: string; readonly promptId: string; readonly prompt: ProviderAuthPrompt }
  | { readonly type: "provider-auth-notice"; readonly loginId: string; readonly notice: ProviderAuthNotice };

export interface ProviderAuthInteraction {
  readonly providerId: string;
  readonly authType: ProviderAuthType;
  readonly loginId: string;
  readonly signal?: AbortSignal;
  readonly notify: (notice: ProviderAuthNotice) => void;
  readonly prompt: (prompt: ProviderAuthPrompt, promptId?: string) => Promise<string>;
}

export interface ProviderAuthResponseRequest {
  readonly loginId: string;
  readonly promptId: string;
  readonly value: string;
}

export interface ProviderLoginRequest {
  readonly providerId: string;
  readonly authType: ProviderAuthType;
  readonly loginId: string;
}

export interface ProviderLogoutRequest {
  readonly providerId: string;
  readonly credentialId: string;
}

export interface ProviderLoginResult {
  readonly credentialType: ProviderAuthType;
}

export interface ModelDescriptor {
  readonly id: string;
  readonly name: string;
  readonly description?: string;
  readonly knowledgeCutoff?: string;
  readonly reasoning?: boolean;
  readonly reasoningEfforts?: readonly string[];
  readonly attachment?: boolean;
  readonly toolCall?: boolean;
  readonly status?: string;
  readonly modalities?: ModelModalities;
  readonly limits?: ModelLimits;
  readonly cost?: ModelCost;
  readonly releaseDate?: string;
}

export interface ModelModalities {
  readonly input?: readonly string[];
  readonly output?: readonly string[];
}

export interface ModelLimits {
  readonly context?: number;
  readonly input?: number;
  readonly output?: number;
}

export interface ModelCost {
  readonly input?: number;
  readonly output?: number;
  readonly cacheRead?: number;
  readonly cacheWrite?: number;
}

export interface ProviderBinding {
  readonly id: string;
  readonly name: string;
  readonly packageName: string | null;
  readonly api?: string;
  readonly env?: readonly string[];
  readonly models: readonly ModelDescriptor[];
}

export interface RuntimeProviderBindingInput {
  readonly runtimeProviderId: string;
  readonly catalogProviderId: string;
  readonly includeModel?: (model: ModelDescriptor) => boolean;
}

export interface RuntimeProviderBinding {
  readonly runtimeProviderId: string;
  readonly catalogProviderId: string;
  readonly models: readonly ModelDescriptor[];
}

export interface ModelsDevCatalog {
  readonly providers: readonly ProviderBinding[];
}

export type CatalogModelPredicate = (model: ModelDescriptor, provider: ProviderBinding) => boolean;

export class ModelsDevParseError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "ModelsDevParseError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requiredString(value: unknown, path: string): string {
  if (typeof value !== "string" || value.trim() === "") throw new ModelsDevParseError(`${path} must be a non-empty string`);
  return value.trim();
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function optionalBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function optionalNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
}

function stringList(value: unknown): readonly string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const entries = [...new Set(value.flatMap((item) => typeof item === "string" && item.trim() ? [item.trim()] : []))];
  return entries.length > 0 ? entries : undefined;
}

function modelModalities(value: unknown): ModelModalities | undefined {
  if (!isRecord(value)) return undefined;
  const input = stringList(value.input);
  const output = stringList(value.output);
  return input || output ? { ...(input ? { input } : {}), ...(output ? { output } : {}) } : undefined;
}

function modelLimits(value: unknown): ModelLimits | undefined {
  if (!isRecord(value)) return undefined;
  const context = optionalNumber(value.context);
  const input = optionalNumber(value.input);
  const output = optionalNumber(value.output);
  return context !== undefined || input !== undefined || output !== undefined
    ? { ...(context !== undefined ? { context } : {}), ...(input !== undefined ? { input } : {}), ...(output !== undefined ? { output } : {}) }
    : undefined;
}

function modelCost(value: unknown): ModelCost | undefined {
  if (!isRecord(value)) return undefined;
  const input = optionalNumber(value.input);
  const output = optionalNumber(value.output);
  const cacheRead = optionalNumber(value.cache_read);
  const cacheWrite = optionalNumber(value.cache_write);
  return input !== undefined || output !== undefined || cacheRead !== undefined || cacheWrite !== undefined
    ? { ...(input !== undefined ? { input } : {}), ...(output !== undefined ? { output } : {}), ...(cacheRead !== undefined ? { cacheRead } : {}), ...(cacheWrite !== undefined ? { cacheWrite } : {}) }
    : undefined;
}

function reasoningEfforts(value: unknown): readonly string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const efforts = [...new Set(value.flatMap((option) => isRecord(option)
    ? [option.values, option.options, option.efforts].flatMap((candidate) => stringList(candidate) ?? [])
    : []))];
  return efforts.length > 0 ? efforts : undefined;
}

export function normalizeProviderId(value: string): string {
  const normalized = value.trim().toLowerCase().replace(/[ _]+/g, "-");
  if (!/^[a-z0-9][a-z0-9._-]{0,63}$/.test(normalized)) throw new ModelsDevParseError(`invalid provider id: ${value}`);
  return normalized;
}

export function normalizeModelId(value: string): string {
  const normalized = value.trim();
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,119}$/.test(normalized)) throw new ModelsDevParseError(`invalid model id: ${value}`);
  return normalized;
}

export function parseModelsDevPayload(payload: unknown): ModelsDevCatalog {
  if (!isRecord(payload)) throw new ModelsDevParseError("models.dev payload must be an object");
  const rawProviders = payload.providers ?? payload;
  if (!isRecord(rawProviders)) throw new ModelsDevParseError("models.dev providers must be an object");
  const providers = Object.entries(rawProviders).flatMap(([key, raw]) => {
    if (!isRecord(raw)) return [];
    let id: string;
    try { id = normalizeProviderId(typeof raw.id === "string" ? raw.id : key); } catch { return []; }
    const name = typeof raw.name === "string" && raw.name.trim() ? raw.name.trim() : id;
    if (!isRecord(raw.models)) return [];
    const models = Object.entries(raw.models).flatMap(([modelKey, model]) => {
      if (!isRecord(model)) return [];
      let modelId: string;
      try { modelId = normalizeModelId(typeof model.id === "string" ? model.id : modelKey); } catch { return []; }
      const modelName = typeof model.name === "string" && model.name.trim() ? model.name.trim() : modelId;
      const description = optionalString(model.description);
      const knowledgeCutoff = optionalString(model.knowledge_cutoff) ?? optionalString(model.knowledge);
      const reasoning = optionalBoolean(model.reasoning);
      const efforts = reasoningEfforts(model.reasoning_options);
      const attachment = optionalBoolean(model.attachment);
      const toolCall = optionalBoolean(model.tool_call);
      const status = optionalString(model.status) ?? (optionalBoolean(model.deprecated) ? "deprecated" : undefined);
      const modalities = modelModalities(model.modalities);
      const limits = modelLimits(model.limit);
      const cost = modelCost(model.cost);
      const releaseDate = optionalString(model.release_date);
      const descriptor: ModelDescriptor = {
        id: modelId,
        name: modelName,
        ...(description ? { description } : {}),
        ...(knowledgeCutoff ? { knowledgeCutoff } : {}),
        ...(reasoning !== undefined ? { reasoning } : {}),
        ...(efforts ? { reasoningEfforts: efforts } : {}),
        ...(attachment !== undefined ? { attachment } : {}),
        ...(toolCall !== undefined ? { toolCall } : {}),
        ...(status ? { status } : {}),
        ...(modalities ? { modalities } : {}),
        ...(limits ? { limits } : {}),
        ...(cost ? { cost } : {}),
        ...(releaseDate ? { releaseDate } : {}),
      };
      return [descriptor];
    });
    const validModels = models.filter((model): model is ModelDescriptor => model !== null);
    validModels.sort((left, right) => (right.releaseDate ?? "").localeCompare(left.releaseDate ?? "") || left.id.localeCompare(right.id));
    const seenModelIds = new Set<string>();
    const unique = validModels.filter((model) => {
      if (seenModelIds.has(model.id)) return false;
      seenModelIds.add(model.id);
      return true;
    });
    const packageName = raw.npm === undefined || raw.npm === null
      ? null
      : typeof raw.npm === "string" && raw.npm.trim()
        ? raw.npm.trim()
        : null;
    const api = optionalString(raw.api);
    const env = stringList(raw.env);
    return unique.length > 0 ? [{ id, name, packageName, ...(api ? { api } : {}), ...(env ? { env } : {}), models: unique }] : [];
  });
  providers.sort((left, right) => left.id.localeCompare(right.id));
  return { providers: providers.filter((provider, index) => index === 0 || providers[index - 1]?.id !== provider.id) };
}

export function providerBinding(catalog: ModelsDevCatalog, providerId: string): ProviderBinding | null {
  const normalized = normalizeProviderId(providerId);
  return catalog.providers.find((provider) => provider.id === normalized) ?? null;
}

export function filterProviderModels(catalog: ModelsDevCatalog, providerId: string, modelIds: readonly string[]): readonly ModelDescriptor[] {
  const provider = providerBinding(catalog, providerId);
  if (!provider) return [];
  const allowed = new Set(modelIds.map(normalizeModelId));
  return provider.models.filter((model) => allowed.has(model.id));
}

export function supportsTextToolCalls(model: ModelDescriptor): boolean {
  return model.toolCall === true && model.modalities?.output?.includes("text") === true;
}

export function filterCatalogModels(catalog: ModelsDevCatalog, includeModel: CatalogModelPredicate): ModelsDevCatalog {
  return {
    providers: catalog.providers.flatMap((provider) => {
      const models = provider.models.filter((model) => includeModel(model, provider));
      return models.length > 0 ? [{ ...provider, models: models.map(cloneModelDescriptor) }] : [];
    }),
  };
}

export function agentModelCatalog(catalog: ModelsDevCatalog): ModelsDevCatalog {
  return filterCatalogModels(catalog, (model) => model.status !== "deprecated" && supportsTextToolCalls(model));
}

export function bindRuntimeProviders(catalog: ModelsDevCatalog, bindings: readonly RuntimeProviderBindingInput[]): readonly RuntimeProviderBinding[] {
  return bindings.map((binding) => {
    const provider = providerBinding(catalog, binding.catalogProviderId);
    const models = provider?.models.filter((model) => binding.includeModel === undefined || binding.includeModel(model)) ?? [];
    return { runtimeProviderId: normalizeProviderId(binding.runtimeProviderId), catalogProviderId: provider?.id ?? normalizeProviderId(binding.catalogProviderId), models };
  });
}

export type CatalogSnapshotStatus = "cached" | "live" | "fallback" | "error";

export interface CatalogSnapshot {
  readonly status: CatalogSnapshotStatus;
  readonly sourceStatus: Exclude<CatalogSnapshotStatus, "error"> | null;
  readonly catalog: ModelsDevCatalog | null;
  readonly fetchedAtUtc: string | null;
  readonly error: string | null;
}

export class CatalogCache {
  private current: CatalogSnapshot;
  private refreshing: Promise<CatalogSnapshot> | null = null;

  public constructor(initial?: unknown) {
    if (initial === undefined) {
      this.current = { status: "error", sourceStatus: null, catalog: null, fetchedAtUtc: null, error: "no catalog snapshot" };
      return;
    }
    const catalog = parseModelsDevPayload(initial);
    if (catalog.providers.length === 0) throw new ModelsDevParseError("models.dev payload contains no usable providers");
    this.current = { status: "cached", sourceStatus: "cached", catalog: cloneCatalog(catalog), fetchedAtUtc: new Date().toISOString(), error: null };
  }

  public snapshot(): CatalogSnapshot {
    return cloneCatalogSnapshot(this.current);
  }

  public accept(payload: unknown, status: Exclude<CatalogSnapshotStatus, "error">): CatalogSnapshot {
    const catalog = parseModelsDevPayload(payload);
    if (catalog.providers.length === 0) throw new ModelsDevParseError("models.dev payload contains no usable providers");
    this.current = { status, sourceStatus: status, catalog: cloneCatalog(catalog), fetchedAtUtc: new Date().toISOString(), error: null };
    return this.snapshot();
  }

  public fail(error: unknown): CatalogSnapshot {
    this.current = {
      ...this.current,
      status: "error",
      error: error instanceof Error ? error.message : String(error),
    };
    return this.snapshot();
  }

  public refresh(loader: () => Promise<unknown>): Promise<CatalogSnapshot> {
    if (!this.refreshing) {
      this.refreshing = Promise.resolve()
        .then(loader)
        .then((payload) => this.accept(payload, "live"))
        .catch((error: unknown) => this.fail(error))
        .finally(() => { this.refreshing = null; });
    }
    return this.refreshing;
  }
}

function cloneCatalog(catalog: ModelsDevCatalog): ModelsDevCatalog {
  return {
    providers: catalog.providers.map((provider) => ({
      id: provider.id,
      name: provider.name,
      packageName: provider.packageName,
      ...(provider.api ? { api: provider.api } : {}),
      ...(provider.env ? { env: [...provider.env] } : {}),
      models: provider.models.map(cloneModelDescriptor),
    })),
  };
}

function cloneModelDescriptor(model: ModelDescriptor): ModelDescriptor {
  return {
    ...model,
    ...(model.reasoningEfforts ? { reasoningEfforts: [...model.reasoningEfforts] } : {}),
    ...(model.modalities ? {
      modalities: {
        ...(model.modalities.input ? { input: [...model.modalities.input] } : {}),
        ...(model.modalities.output ? { output: [...model.modalities.output] } : {}),
      },
    } : {}),
    ...(model.limits ? { limits: { ...model.limits } } : {}),
    ...(model.cost ? { cost: { ...model.cost } } : {}),
  };
}

function cloneCatalogSnapshot(snapshot: CatalogSnapshot): CatalogSnapshot {
  return {
    status: snapshot.status,
    sourceStatus: snapshot.sourceStatus,
    catalog: snapshot.catalog ? cloneCatalog(snapshot.catalog) : null,
    fetchedAtUtc: snapshot.fetchedAtUtc,
    error: snapshot.error,
  };
}

export interface CredentialMetadata {
  readonly id: string;
  readonly providerId: string;
  readonly authMethod: AuthMethod;
  readonly enabled: boolean;
  readonly weight: number;
  readonly modelIds: readonly string[];
  readonly health: CredentialHealth;
  readonly cooldownUntilUtc: string | null;
  readonly extend: CredentialExtend;
}

export type CredentialExtendValue = string | number | boolean | null;
export type CredentialExtend = Readonly<Record<string, CredentialExtendValue>>;

export interface CredentialInput {
  readonly id: string;
  readonly providerId: string;
  readonly authMethod: AuthMethod;
  readonly enabled?: boolean;
  readonly weight?: number;
  readonly modelIds: readonly string[];
  readonly extend?: CredentialExtend;
}

function credentialId(value: unknown): string {
  if (typeof value !== "string" || !value.trim() || /[\u0000-\u001f]/.test(value)) throw new Error("credential id must be opaque and non-empty");
  return value;
}

function credentialWeight(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value) || !Number.isInteger(value) || value < 1 || value > 100) {
    throw new Error("credential weight must be a finite integer between 1 and 100");
  }
  return value;
}

function credentialModelIds(value: unknown): readonly string[] {
  if (!Array.isArray(value)) throw new Error("credential model ids must be an array");
  return [...new Set(value.map((modelId) => {
    if (typeof modelId !== "string") throw new Error("credential model ids must be strings");
    return normalizeModelId(modelId);
  }))].sort();
}

const FORBIDDEN_EXTEND_KEYS = /(?:token|secret|password|cookie|authorization|api[_-]?key|refresh|bearer)/i;

function credentialExtend(value: unknown): CredentialExtend {
  if (value === undefined) return {};
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("credential extend must be an object");
  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length > 32) throw new Error("credential extend supports at most 32 fields");
  const result: Record<string, CredentialExtendValue> = {};
  for (const [key, item] of entries) {
    if (!/^[a-zA-Z][a-zA-Z0-9._-]{0,63}$/.test(key) || FORBIDDEN_EXTEND_KEYS.test(key)) throw new Error("credential extend contains an invalid field name");
    if (typeof item === "string") {
      if (item.length > 4096) throw new Error("credential extend string values are too long");
      result[key] = item;
    } else if (typeof item === "number") {
      if (!Number.isFinite(item)) throw new Error("credential extend numbers must be finite");
      result[key] = item;
    } else if (typeof item === "boolean" || item === null) {
      result[key] = item;
    } else throw new Error("credential extend values must be scalar");
  }
  return result;
}

function credentialHealth(value: unknown): CredentialHealth {
  if (value !== "healthy" && value !== "cooling-down" && value !== "permanently-failed") throw new Error("invalid credential health");
  return value;
}

function cooldownUntilUtc(value: unknown, health: CredentialHealth): string | null {
  if (health !== "cooling-down") {
    if (value !== null) throw new Error("only cooling-down credentials can have a cooldown");
    return null;
  }
  if (typeof value !== "string" || Number.isNaN(Date.parse(value))) throw new Error("cooling-down credentials require a valid cooldown timestamp");
  return value;
}

function projectCredential(input: Record<string, unknown>, defaults?: Pick<CredentialMetadata, "health" | "cooldownUntilUtc">): CredentialMetadata {
  const authMethod = input.authMethod;
  if (authMethod !== "oauth" && authMethod !== "api-key") throw new Error("unsupported authentication method");
  if (typeof input.enabled !== "boolean") throw new Error("credential enabled must be boolean");
  const health = credentialHealth(input.health ?? defaults?.health ?? "healthy");
  const cooldown = cooldownUntilUtc(input.cooldownUntilUtc ?? defaults?.cooldownUntilUtc ?? null, health);
  return {
    id: credentialId(input.id),
    providerId: normalizeProviderId(typeof input.providerId === "string" ? input.providerId : ""),
    authMethod,
    enabled: input.enabled,
    weight: credentialWeight(input.weight),
    modelIds: credentialModelIds(input.modelIds),
    extend: credentialExtend(input.extend),
    health,
    cooldownUntilUtc: cooldown,
  };
}

function cloneCredential(input: CredentialMetadata): CredentialMetadata {
  return projectCredential(input as unknown as Record<string, unknown>);
}

export function createCredentialMetadata(input: CredentialInput): CredentialMetadata {
  return projectCredential({ ...input, enabled: input.enabled ?? true, weight: input.weight ?? 1 });
}

export function serializeCredentialMetadata(credential: CredentialMetadata): string {
  return JSON.stringify({
    id: credential.id,
    providerId: credential.providerId,
    authMethod: credential.authMethod,
    enabled: credential.enabled,
    weight: credential.weight,
    modelIds: [...credential.modelIds],
    extend: { ...credential.extend },
    health: credential.health,
    cooldownUntilUtc: credential.cooldownUntilUtc,
  });
}

export interface RouteRequest {
  readonly providerId: string;
  readonly modelId: string;
}

export type RouteError =
  | { readonly kind: "http"; readonly status: number }
  | { readonly kind: "transport" };

export interface CredentialHealthSummary {
  readonly health: CredentialHealth;
  readonly cooldownUntilUtc: string | null;
}

export interface CredentialRouterOptions {
  readonly strategy?: RouteStrategy;
  readonly now?: () => number;
  readonly transientCooldownMs?: number;
  readonly rateLimitCooldownMs?: number;
}

export class CredentialRouter {
  private readonly credentials = new Map<string, CredentialMetadata>();
  private readonly order: string[] = [];
  private readonly failures = new Map<string, number>();
  private readonly cursor = new Map<string, number>();
  private readonly now: () => number;
  private strategy: RouteStrategy;
  private readonly providerStrategies = new Map<string, RouteStrategy>();
  private readonly providerOAuthEnabled = new Map<string, boolean>();
  private readonly transientCooldownMs: number;
  private readonly rateLimitCooldownMs: number;

  public constructor(credentials: readonly CredentialMetadata[], options: CredentialRouterOptions = {}) {
    this.now = options.now ?? Date.now;
    this.strategy = options.strategy ?? "round-robin";
    validateStrategy(this.strategy);
    this.transientCooldownMs = Math.max(1, options.transientCooldownMs ?? 15_000);
    this.rateLimitCooldownMs = Math.max(this.transientCooldownMs, options.rateLimitCooldownMs ?? 60_000);
    for (const credential of credentials) this.upsert(credential);
  }

  public upsert(credential: CredentialMetadata): void {
    const projected = cloneCredential(credential);
    const current = this.credentials.get(projected.id);
    if (!current) this.order.push(projected.id);
    this.credentials.set(projected.id, current
      ? { ...projected, health: current.health, cooldownUntilUtc: current.cooldownUntilUtc }
      : projected);
  }

  public setStrategy(strategy: RouteStrategy, providerId?: string): void {
    validateStrategy(strategy);
    if (providerId === undefined) {
      this.strategy = strategy;
      return;
    }
    this.providerStrategies.set(normalizeProviderId(providerId), strategy);
  }

  public setProviderOAuthEnabled(providerId: string, enabled: boolean): void {
    if (typeof enabled !== "boolean") throw new Error("provider OAuth policy must be boolean");
    this.providerOAuthEnabled.set(normalizeProviderId(providerId), enabled);
  }

  public setEnabled(credentialId: string, enabled: boolean): void {
    const current = this.credentials.get(credentialId);
    if (current) this.credentials.set(credentialId, { ...current, enabled });
  }

  public setWeight(credentialId: string, weight: number): void {
    const current = this.credentials.get(credentialId);
    if (current) this.credentials.set(credentialId, { ...current, weight: credentialWeight(weight) });
  }

  public setExtend(credentialId: string, extend: CredentialExtend): void {
    const current = this.credentials.get(credentialId);
    if (current) this.credentials.set(credentialId, { ...current, extend: credentialExtend(extend) });
  }

  public resetHealth(credentialId: string): void {
    const current = this.credentials.get(credentialId);
    if (!current) return;
    this.failures.delete(credentialId);
    this.credentials.set(credentialId, { ...current, health: "healthy", cooldownUntilUtc: null });
  }

  public candidates(request: RouteRequest): readonly CredentialMetadata[] {
    this.pruneExpired();
    const providerId = normalizeProviderId(request.providerId);
    const modelId = normalizeModelId(request.modelId);
    const matchesRequest = (credential: CredentialMetadata) => credential.enabled
      && credential.providerId === providerId
      && credential.modelIds.includes(modelId)
      && (credential.authMethod !== "oauth" || this.providerOAuthEnabled.get(providerId) !== false)
      && this.isEligible(credential);
    const eligible = this.order.map((id) => this.credentials.get(id)).filter((credential): credential is CredentialMetadata => Boolean(credential))
      .filter(matchesRequest)
      .sort((left, right) => left.id.localeCompare(right.id));
    const strategy = this.providerStrategies.get(providerId) ?? this.strategy;
    if (strategy === "failover") {
      return this.order.map((id) => this.credentials.get(id)).filter((credential): credential is CredentialMetadata => Boolean(credential))
        .filter(matchesRequest)
        .map(cloneCredential);
    }
    if (eligible.length < 2) return eligible.map(cloneCredential);
    const key = `${providerId}\u0000${modelId}`;
    const ordered = strategy === "weighted-round-robin" ? this.weightedOrder(eligible, key) : this.rotatedOrder(eligible, key);
    return ordered.map(cloneCredential);
  }

  public reportSuccess(credentialId: string): void {
    const current = this.credentials.get(credentialId);
    if (!current || current.health === "permanently-failed") return;
    this.resetHealth(credentialId);
  }

  public reportError(credentialId: string, error: RouteError): void {
    const current = this.credentials.get(credentialId);
    if (!current) return;
    if (current.health === "permanently-failed") return;
    if (error.kind === "http" && (error.status === 401 || error.status === 403)) {
      this.credentials.set(credentialId, { ...current, health: "permanently-failed", cooldownUntilUtc: null });
      return;
    }
    const rateLimited = error.kind === "http" && error.status === 429;
    const server = error.kind === "transport" || (error.kind === "http" && error.status >= 500 && error.status <= 599);
    if (!rateLimited && !server) return;
    const failureCount = (this.failures.get(credentialId) ?? 0) + 1;
    this.failures.set(credentialId, failureCount);
    const base = rateLimited ? this.rateLimitCooldownMs : this.transientCooldownMs;
    const maximum = rateLimited ? this.rateLimitCooldownMs * 8 : this.transientCooldownMs * 8;
    const until = new Date(this.now() + Math.min(maximum, base * (2 ** Math.min(failureCount - 1, 3)))).toISOString();
    this.credentials.set(credentialId, { ...current, health: "cooling-down", cooldownUntilUtc: until });
  }

  public health(credentialId: string): CredentialHealthSummary | null {
    this.pruneExpired();
    const current = this.credentials.get(credentialId);
    if (!current) return null;
    return { health: current.health, cooldownUntilUtc: current.cooldownUntilUtc };
  }

  public remove(credentialId: string): void {
    this.credentials.delete(credentialId);
    const index = this.order.indexOf(credentialId);
    if (index >= 0) this.order.splice(index, 1);
    this.failures.delete(credentialId);
    this.cursor.clear();
  }

  public snapshot(): readonly CredentialMetadata[] {
    this.pruneExpired();
    return this.order.map((id) => this.credentials.get(id)).filter((credential): credential is CredentialMetadata => Boolean(credential)).map(cloneCredential);
  }

  private pruneExpired(): void {
    for (const [id, credential] of this.credentials) {
      if (credential.health === "cooling-down" && credential.cooldownUntilUtc && Date.parse(credential.cooldownUntilUtc) <= this.now()) {
        this.credentials.set(id, { ...credential, health: "healthy", cooldownUntilUtc: null });
      }
    }
  }

  private isEligible(credential: CredentialMetadata): boolean {
    if (credential.health === "permanently-failed") return false;
    return credential.health !== "cooling-down" || !credential.cooldownUntilUtc || Date.parse(credential.cooldownUntilUtc) <= this.now();
  }

  private rotatedOrder(eligible: CredentialMetadata[], key: string): CredentialMetadata[] {
    const start = (this.cursor.get(key) ?? 0) % eligible.length;
    this.cursor.set(key, start + 1);
    return [...eligible.slice(start), ...eligible.slice(0, start)];
  }

  private weightedOrder(eligible: CredentialMetadata[], key: string): CredentialMetadata[] {
    const slots = eligible.flatMap((credential) => Array.from({ length: credential.weight }, () => credential));
    const start = (this.cursor.get(key) ?? 0) % slots.length;
    this.cursor.set(key, start + 1);
    const result: CredentialMetadata[] = [];
    for (let offset = 0; offset < slots.length && result.length < eligible.length; offset += 1) {
      const candidate = slots[(start + offset) % slots.length];
      if (candidate && !result.some((item) => item.id === candidate.id)) result.push(candidate);
    }
    return result;
  }
}

function validateStrategy(strategy: RouteStrategy): void {
  if (strategy !== "round-robin" && strategy !== "weighted-round-robin" && strategy !== "failover") throw new Error("invalid route strategy");
}

export interface ProviderCapabilityDescriptor {
  readonly providerId: string;
  readonly displayName: string;
  readonly authMethods: readonly AuthMethod[];
  readonly defaultModelId: string;
  readonly models: readonly string[];
}

export interface ProviderRequest {
  readonly modelId: string;
  readonly input: unknown;
  readonly parameters?: Readonly<Record<string, unknown>>;
}

export interface ProviderRequestContext {
  readonly signal?: AbortSignal;
}

export interface ProviderResponse {
  readonly output: unknown;
  readonly modelId?: string;
  readonly usage?: unknown;
  readonly finishReason?: string | null;
}

export type ProviderStreamEvent =
  | { readonly type: "output"; readonly value: unknown }
  | { readonly type: "usage"; readonly value: unknown }
  | { readonly type: "notice"; readonly value: unknown }
  | { readonly type: "done"; readonly finishReason?: string | null };

export type ProviderUsageStatus = "ok" | "unknown" | "error";

export interface ProviderUsageWindow {
  readonly id: string;
  readonly label: string;
  readonly usedPercent: number | null;
  readonly remainingPercent?: number | null;
  readonly resetAt: number | null;
  readonly windowSeconds?: number;
  readonly used?: number | null;
  readonly limit?: number | null;
  readonly remaining?: number | null;
  readonly unit?: string | null;
}

export interface ProviderUsageBalance {
  readonly amount: number;
  readonly unit: string;
}

export type ProviderUsageEstimateSource = "configured" | "learned" | "unknown";
export type ProviderUsageEstimateUnit = "tokens" | "requests";

export interface ProviderUsageEstimate {
  readonly provider: string;
  readonly account: string;
  readonly windowHours: number;
  readonly unit: ProviderUsageEstimateUnit | null;
  readonly windowTokens: number;
  readonly windowRequests: number;
  readonly windowUsage: number;
  readonly limitEstimate: number | null;
  readonly remainingRatio: number | null;
  readonly remainingPercent: number | null;
  readonly confidence: ProviderUsageEstimateSource;
  readonly lowConfidence: boolean;
  readonly observations: number;
  readonly nextResetAt: number | null;
}

export interface ProviderUsageSnapshot {
  readonly providerId: string;
  readonly credentialId: string;
  readonly status: ProviderUsageStatus;
  readonly plan: string | null;
  readonly planMultiplier?: number | null;
  readonly billingInterval?: string | null;
  readonly subscriptionRenewsAt?: number | null;
  readonly subscriptionExpiresAt?: number | null;
  readonly metadataError?: string | null;
  readonly windows: readonly ProviderUsageWindow[];
  readonly balance: ProviderUsageBalance | null;
  readonly estimate?: ProviderUsageEstimate | null;
  readonly fetchedAtUtc: string;
  readonly error: string | null;
}

export interface ProviderAdapterHost {
  authorize(context?: ProviderAuthInteraction): Promise<CredentialMetadata>;
  logout?(credentialId: string): Promise<void>;
  remove(credentialId: string): Promise<void>;
  refresh?(credentialId: string): Promise<CredentialMetadata>;
  request?(credentialId: string, request: ProviderRequest, context: ProviderRequestContext): Promise<ProviderResponse>;
  stream?(credentialId: string, request: ProviderRequest, context: ProviderRequestContext): AsyncIterable<ProviderStreamEvent>;
  queryUsage?(credentialId: string, context?: ProviderRequestContext): Promise<ProviderUsageSnapshot>;
  capability?: ProviderCapabilityOverride;
}

export interface ProviderCapabilityOverride {
  readonly models?: readonly string[];
  readonly defaultModelId?: string;
}

export interface ProviderAdapter {
  readonly capability: ProviderCapabilityDescriptor;
  readonly host: ProviderAdapterHost;
}

export const OPENAI_CAPABILITY_DESCRIPTOR: ProviderCapabilityDescriptor = {
  providerId: "openai-codex",
  displayName: "OpenAI",
  authMethods: ["oauth"],
  defaultModelId: "",
  models: [],
};

export const ANTHROPIC_CAPABILITY_DESCRIPTOR: ProviderCapabilityDescriptor = {
  providerId: "anthropic",
  displayName: "Anthropic",
  authMethods: ["oauth"],
  defaultModelId: "",
  models: [],
};

export const WORKBUDDY_CAPABILITY_DESCRIPTOR: ProviderCapabilityDescriptor = {
  providerId: "workbuddy",
  displayName: "WorkBuddy",
  authMethods: ["oauth"],
  defaultModelId: "",
  models: [],
};

export const TRAE_CAPABILITY_DESCRIPTOR: ProviderCapabilityDescriptor = {
  providerId: "traecode",
  displayName: "TraeCode",
  authMethods: ["oauth"],
  defaultModelId: "",
  models: [],
};

export const GROK_CAPABILITY_DESCRIPTOR: ProviderCapabilityDescriptor = {
  providerId: "grok",
  displayName: "Grok",
  authMethods: ["oauth"],
  defaultModelId: "",
  models: [],
};

function adapter(capability: ProviderCapabilityDescriptor, host: ProviderAdapterHost): ProviderAdapter {
  const delegated: ProviderAdapterHost = {
    authorize: async (context) => validateAdapterCredential(capability, await host.authorize(context)),
    remove: (credentialId) => host.remove(credentialId),
  };
  if (host.logout) delegated.logout = (credentialId) => host.logout!(credentialId);
  if (host.refresh) {
    delegated.refresh = async (credentialId) => validateAdapterCredential(capability, await host.refresh!(credentialId));
  }
  if (host.request) delegated.request = (credentialId, request, context) => host.request!(credentialId, request, context);
  if (host.stream) delegated.stream = (credentialId, request, context) => host.stream!(credentialId, request, context);
  if (host.queryUsage) {
    delegated.queryUsage = async (credentialId, context) => validateUsageSnapshot(capability, credentialId, await host.queryUsage!(credentialId, context));
  }
  return {
    capability,
    host: delegated,
  };
}

function validateAdapterCredential(capability: ProviderCapabilityDescriptor, credential: CredentialMetadata): CredentialMetadata {
  if (credential.providerId !== capability.providerId || !capability.authMethods.includes(credential.authMethod)) throw new Error("adapter returned an incompatible credential");
  return cloneCredential(credential);
}

function validateUsageEstimate(estimate: ProviderUsageEstimate): ProviderUsageEstimate {
  if (!estimate || typeof estimate !== "object"
    || typeof estimate.provider !== "string" || !estimate.provider.trim()
    || typeof estimate.account !== "string" || !estimate.account.trim()
    || typeof estimate.windowHours !== "number" || !Number.isFinite(estimate.windowHours) || estimate.windowHours <= 0
    || (estimate.unit !== null && estimate.unit !== "tokens" && estimate.unit !== "requests")
    || typeof estimate.windowTokens !== "number" || !Number.isFinite(estimate.windowTokens) || estimate.windowTokens < 0
    || typeof estimate.windowRequests !== "number" || !Number.isFinite(estimate.windowRequests) || estimate.windowRequests < 0
    || typeof estimate.windowUsage !== "number" || !Number.isFinite(estimate.windowUsage) || estimate.windowUsage < 0
    || (estimate.limitEstimate !== null && (typeof estimate.limitEstimate !== "number" || !Number.isFinite(estimate.limitEstimate) || estimate.limitEstimate < 0))
    || (estimate.remainingRatio !== null && (typeof estimate.remainingRatio !== "number" || !Number.isFinite(estimate.remainingRatio) || estimate.remainingRatio < 0 || estimate.remainingRatio > 1))
    || (estimate.remainingPercent !== null && (typeof estimate.remainingPercent !== "number" || !Number.isFinite(estimate.remainingPercent) || estimate.remainingPercent < 0 || estimate.remainingPercent > 100))
    || (estimate.remainingRatio === null ? estimate.remainingPercent !== null : estimate.remainingPercent === null
      || Math.abs(estimate.remainingPercent - estimate.remainingRatio * 100) > Number.EPSILON * Math.max(1, Math.abs(estimate.remainingPercent)))
    || !["configured", "learned", "unknown"].includes(estimate.confidence)
    || typeof estimate.lowConfidence !== "boolean"
    || !Number.isInteger(estimate.observations) || estimate.observations < 0
    || (estimate.nextResetAt !== null && (typeof estimate.nextResetAt !== "number" || !Number.isFinite(estimate.nextResetAt)))) {
    throw new Error("adapter returned an invalid usage estimate");
  }
  return {
    provider: estimate.provider.trim(),
    account: estimate.account.trim(),
    windowHours: estimate.windowHours,
    unit: estimate.unit,
    windowTokens: estimate.windowTokens,
    windowRequests: estimate.windowRequests,
    windowUsage: estimate.windowUsage,
    limitEstimate: estimate.limitEstimate,
    remainingRatio: estimate.remainingRatio,
    remainingPercent: estimate.remainingPercent,
    confidence: estimate.confidence,
    lowConfidence: estimate.lowConfidence,
    observations: estimate.observations,
    nextResetAt: estimate.nextResetAt,
  };
}

function validateUsageSnapshot(capability: ProviderCapabilityDescriptor, credentialId: string, snapshot: ProviderUsageSnapshot): ProviderUsageSnapshot {
  if (!snapshot || typeof snapshot !== "object" || snapshot.providerId !== capability.providerId
    || snapshot.credentialId !== credentialId || typeof snapshot.credentialId !== "string" || !snapshot.credentialId.trim()
    || !["ok", "unknown", "error"].includes(snapshot.status)
    || (snapshot.plan !== null && typeof snapshot.plan !== "string")
    || (snapshot.planMultiplier !== undefined && snapshot.planMultiplier !== null && (typeof snapshot.planMultiplier !== "number" || !Number.isFinite(snapshot.planMultiplier)))
    || (snapshot.billingInterval !== undefined && snapshot.billingInterval !== null && typeof snapshot.billingInterval !== "string")
    || (snapshot.subscriptionRenewsAt !== undefined && snapshot.subscriptionRenewsAt !== null && (typeof snapshot.subscriptionRenewsAt !== "number" || !Number.isFinite(snapshot.subscriptionRenewsAt)))
    || (snapshot.subscriptionExpiresAt !== undefined && snapshot.subscriptionExpiresAt !== null && (typeof snapshot.subscriptionExpiresAt !== "number" || !Number.isFinite(snapshot.subscriptionExpiresAt)))
    || (snapshot.metadataError !== undefined && snapshot.metadataError !== null && typeof snapshot.metadataError !== "string")
    || !Array.isArray(snapshot.windows)
    || typeof snapshot.fetchedAtUtc !== "string" || Number.isNaN(Date.parse(snapshot.fetchedAtUtc))
    || (snapshot.error !== null && typeof snapshot.error !== "string")) {
    throw new Error("adapter returned an invalid usage snapshot");
  }
  const windows = snapshot.windows.map((window) => {
    if (!window || typeof window !== "object" || typeof window.id !== "string" || !window.id.trim()
      || typeof window.label !== "string" || !window.label.trim()
      || (window.usedPercent !== null && (typeof window.usedPercent !== "number" || !Number.isFinite(window.usedPercent) || window.usedPercent < 0 || window.usedPercent > 100))
      || (window.remainingPercent !== undefined && window.remainingPercent !== null && (typeof window.remainingPercent !== "number" || !Number.isFinite(window.remainingPercent) || window.remainingPercent < 0 || window.remainingPercent > 100))
      || (window.usedPercent !== null && window.remainingPercent !== undefined && window.remainingPercent !== null
        && Math.abs(window.remainingPercent - (100 - window.usedPercent)) > Number.EPSILON * Math.max(1, Math.abs(window.remainingPercent)))
      || (window.resetAt !== null && (typeof window.resetAt !== "number" || !Number.isFinite(window.resetAt)))
      || (window.windowSeconds !== undefined && (typeof window.windowSeconds !== "number" || !Number.isFinite(window.windowSeconds) || window.windowSeconds <= 0))
      || (window.used !== undefined && window.used !== null && (typeof window.used !== "number" || !Number.isFinite(window.used)))
      || (window.limit !== undefined && window.limit !== null && (typeof window.limit !== "number" || !Number.isFinite(window.limit)))
      || (window.remaining !== undefined && window.remaining !== null && (typeof window.remaining !== "number" || !Number.isFinite(window.remaining)))
      || (window.unit !== undefined && window.unit !== null && (typeof window.unit !== "string" || !window.unit.trim() || window.unit.length > 64))) {
      throw new Error("adapter returned an invalid usage window");
    }
    return {
      id: window.id.trim(),
      label: window.label.trim(),
      usedPercent: window.usedPercent,
      ...(window.remainingPercent !== undefined ? { remainingPercent: window.remainingPercent } : {}),
      resetAt: window.resetAt,
      ...(window.windowSeconds !== undefined ? { windowSeconds: window.windowSeconds } : {}),
      ...(window.used !== undefined ? { used: window.used } : {}),
      ...(window.limit !== undefined ? { limit: window.limit } : {}),
      ...(window.remaining !== undefined ? { remaining: window.remaining } : {}),
      ...(window.unit !== undefined ? { unit: window.unit === null ? null : window.unit.trim() } : {}),
    };
  });
  const balance = snapshot.balance === null ? null : snapshot.balance && typeof snapshot.balance === "object"
    && typeof snapshot.balance.amount === "number" && Number.isFinite(snapshot.balance.amount)
    && typeof snapshot.balance.unit === "string" && snapshot.balance.unit.trim()
    ? { amount: snapshot.balance.amount, unit: snapshot.balance.unit.trim() }
    : undefined;
  if (snapshot.balance !== null && !balance) throw new Error("adapter returned an invalid usage balance");
  const estimate = snapshot.estimate === undefined ? undefined : snapshot.estimate === null ? null : validateUsageEstimate(snapshot.estimate);
  return {
    providerId: capability.providerId,
    credentialId: snapshot.credentialId,
    status: snapshot.status,
    plan: snapshot.plan,
    ...(snapshot.planMultiplier !== undefined ? { planMultiplier: snapshot.planMultiplier } : {}),
    ...(snapshot.billingInterval !== undefined ? { billingInterval: snapshot.billingInterval } : {}),
    ...(snapshot.subscriptionRenewsAt !== undefined ? { subscriptionRenewsAt: snapshot.subscriptionRenewsAt } : {}),
    ...(snapshot.subscriptionExpiresAt !== undefined ? { subscriptionExpiresAt: snapshot.subscriptionExpiresAt } : {}),
    ...(snapshot.metadataError !== undefined ? { metadataError: safeUsageText(snapshot.metadataError) } : {}),
    windows,
    balance: balance ?? null,
    ...(estimate !== undefined ? { estimate } : {}),
    fetchedAtUtc: snapshot.fetchedAtUtc,
    error: safeUsageText(snapshot.error),
  };
}

function safeUsageText(value: string | null): string | null {
  if (value === null) return null;
  return value.slice(0, 512).replace(/\b(bearer|token|secret|password|cookie|authorization|api[_-]?key|refresh)\s*[:=]?\s*[^\s,;]+/gi, "$1 [redacted]");
}

function capabilityWithHostOverride(capability: ProviderCapabilityDescriptor, override?: ProviderCapabilityOverride): ProviderCapabilityDescriptor {
  if (!override) return capability;
  const models = override.models === undefined ? [...capability.models] : [...new Set(override.models.map(normalizeModelId))];
  if (models.length === 0) throw new Error("provider capability requires at least one model");
  const defaultModelId = normalizeModelId(override.defaultModelId ?? (models.includes(capability.defaultModelId) ? capability.defaultModelId : models[0]!));
  if (!models.includes(defaultModelId)) throw new Error("provider default model must be listed in capability models");
  return { ...capability, models, defaultModelId };
}

export function createWorkBuddyAdapter(host: ProviderAdapterHost): ProviderAdapter {
  return adapter(capabilityWithHostOverride(WORKBUDDY_CAPABILITY_DESCRIPTOR, host.capability), host);
}

export function createTraeAdapter(host: ProviderAdapterHost): ProviderAdapter {
  return adapter(capabilityWithHostOverride(TRAE_CAPABILITY_DESCRIPTOR, host.capability), host);
}

export function createOpenAIAdapter(host: ProviderAdapterHost): ProviderAdapter {
  return adapter(capabilityWithHostOverride(OPENAI_CAPABILITY_DESCRIPTOR, host.capability), host);
}

export function createAnthropicAdapter(host: ProviderAdapterHost): ProviderAdapter {
  return adapter(capabilityWithHostOverride(ANTHROPIC_CAPABILITY_DESCRIPTOR, host.capability), host);
}

export function createGrokAdapter(host: ProviderAdapterHost): ProviderAdapter {
  return adapter(capabilityWithHostOverride(GROK_CAPABILITY_DESCRIPTOR, host.capability), host);
}
