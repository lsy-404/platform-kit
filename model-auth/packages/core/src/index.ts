export const MODEL_AUTH_VERSION = "0.6.1";

export type AuthMethod = "oauth" | "api-key";
export type ProviderAuthType = "oauth" | "api_key";
export type CredentialHealth = "healthy" | "cooling-down" | "permanently-failed";
export type RouteStrategy = "round-robin" | "failover";

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
      const status = model.deprecated === true ? "deprecated" : optionalString(model.status);
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
  readonly modelIds: readonly string[];
  readonly extend?: CredentialExtend;
}

function credentialId(value: unknown): string {
  if (typeof value !== "string" || !value.trim() || /[\u0000-\u001f]/.test(value)) throw new Error("credential id must be opaque and non-empty");
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
  return projectCredential({ ...input, enabled: input.enabled ?? true });
}

export function serializeCredentialMetadata(credential: CredentialMetadata): string {
  return JSON.stringify({
    id: credential.id,
    providerId: credential.providerId,
    authMethod: credential.authMethod,
    enabled: credential.enabled,
    modelIds: [...credential.modelIds],
    extend: { ...credential.extend },
    health: credential.health,
    cooldownUntilUtc: credential.cooldownUntilUtc,
  });
}

export interface RouteRequest {
  readonly providerId: string;
  readonly modelId: string;
  /** Explicit provider model-family key for matching family-scoped usage windows. */
  readonly modelFamily?: string;
}

export type RouteError =
  | { readonly kind: "http"; readonly status: number; /** Server-provided Retry-After in milliseconds; used for 429 only. */ readonly retryAfterMs?: number }
  | { readonly kind: "transport" };

export type CredentialCooldownReason = "rate-limited" | "transient";

export interface CredentialHealthSummary {
  readonly health: CredentialHealth;
  readonly cooldownUntilUtc: string | null;
  /** Present only while the credential is cooling down. */
  readonly cooldownReason?: CredentialCooldownReason;
}

export interface CredentialRouterOptions {
  readonly strategy?: RouteStrategy;
  readonly now?: () => number;
  readonly transientCooldownMs?: number;
  readonly rateLimitCooldownMs?: number;
  readonly usageMaxAgeMs?: number;
}

export interface CredentialUsageDecision {
  readonly status: "available" | "exhausted" | "unknown";
  readonly reason: "fresh-usage" | "confirmed-exhaustion" | "missing-usage" | "stale-usage" | "unavailable-usage" | "no-applicable-window" | "unknown-window";
  readonly remainingRatio: number | null;
  readonly windowIds: readonly string[];
}

export class CredentialRouter {
  private readonly credentials = new Map<string, CredentialMetadata>();
  private readonly order: string[] = [];
  private readonly failures = new Map<string, number>();
  private readonly cooldownReasons = new Map<string, CredentialCooldownReason>();
  private readonly cursor = new Map<string, number>();
  private readonly now: () => number;
  private strategy: RouteStrategy;
  private readonly providerStrategies = new Map<string, RouteStrategy>();
  private readonly providerOAuthEnabled = new Map<string, boolean>();
  private readonly transientCooldownMs: number;
  private readonly rateLimitCooldownMs: number;
  private readonly usageMaxAgeMs: number;
  private readonly usage = new Map<string, ProviderUsageSnapshot>();

  public constructor(credentials: readonly CredentialMetadata[], options: CredentialRouterOptions = {}) {
    this.now = options.now ?? Date.now;
    this.strategy = options.strategy ?? "round-robin";
    validateStrategy(this.strategy);
    this.transientCooldownMs = Math.max(1, options.transientCooldownMs ?? 15_000);
    this.rateLimitCooldownMs = Math.max(this.transientCooldownMs, options.rateLimitCooldownMs ?? 60_000);
    this.usageMaxAgeMs = options.usageMaxAgeMs ?? 5 * 60_000;
    if (!Number.isFinite(this.usageMaxAgeMs) || this.usageMaxAgeMs <= 0) throw new Error("usage maximum age must be a positive finite number");
    for (const credential of credentials) this.upsert(credential);
  }

  public upsert(credential: CredentialMetadata): void {
    const projected = cloneCredential(credential);
    const current = this.credentials.get(projected.id);
    if (!current) this.order.push(projected.id);
    if (current && (current.providerId !== projected.providerId || current.authMethod !== projected.authMethod)) this.usage.delete(projected.id);
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

  public setOrder(credentialIds: readonly string[]): void {
    if (!Array.isArray(credentialIds) || new Set(credentialIds).size !== credentialIds.length) throw new Error("credential order must be unique ids");
    const slots = credentialIds.map((id) => {
      const index = this.order.indexOf(id);
      if (index < 0) throw new Error("credential order contains an unknown id");
      return index;
    }).sort((left, right) => left - right);
    credentialIds.forEach((id, position) => { this.order[slots[position]!] = id; });
    this.cursor.clear();
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
      .filter(matchesRequest);
    const available = eligible.filter((credential) => this.usageDecision(request, credential.id).status !== "exhausted");
    const strategy = this.providerStrategies.get(providerId) ?? this.strategy;
    if (strategy === "failover" || available.length < 2) return available.map(cloneCredential);
    const key = `${providerId}\u0000${modelId}`;
    const decisions = available.map((credential) => this.usageDecision(request, credential.id));
    if (decisions.every((decision) => decision.status === "available" && decision.remainingRatio !== null)) {
      const remaining = new Map(available.map((credential, index) => [credential.id, decisions[index]!.remainingRatio!]));
      return this.quotaOrdered(available, remaining, key).map(cloneCredential);
    }
    return this.rotatedOrder(available, key).map(cloneCredential);
  }

  /** Set or clear a host-supplied usage snapshot for one credential. */
  public setUsage(credentialId: string, snapshot: ProviderUsageSnapshot | null): void {
    const credential = this.credentials.get(credentialId);
    if (snapshot === null) {
      this.usage.delete(credentialId);
      return;
    }
    if (!credential) throw new Error("usage snapshot references an unknown credential");
    if (!snapshot || snapshot.credentialId !== credentialId || snapshot.providerId !== credential.providerId) {
      throw new Error("usage snapshot identity does not match credential");
    }
    const validated = validateUsageSnapshot({
      providerId: credential.providerId,
      displayName: credential.providerId,
      authMethods: [],
      defaultModelId: credential.modelIds[0] ?? "unknown",
      models: credential.modelIds,
    }, credentialId, snapshot);
    const fetchedAt = Date.parse(snapshot.fetchedAtUtc);
    const observedAt = snapshot.observedAtUtc === undefined ? fetchedAt : typeof snapshot.observedAtUtc === "string" ? Date.parse(snapshot.observedAtUtc) : Number.NaN;
    const now = this.now();
    if (!Number.isFinite(fetchedAt) || !Number.isFinite(observedAt)) throw new Error("usage snapshot timestamp is invalid");
    if (fetchedAt > now || observedAt > now) throw new Error("usage snapshot timestamp cannot be in the future");
    if (observedAt > fetchedAt) throw new Error("usage observation cannot be later than snapshot fetch");
    if (snapshot.basis !== undefined && snapshot.basis !== "accurate" && snapshot.basis !== "estimated") {
      throw new Error("usage snapshot basis is invalid");
    }
    const incomingTime = snapshot.observedAtUtc === undefined ? fetchedAt : observedAt;
    const current = this.usage.get(credentialId);
    if (current) {
      const currentTime = Date.parse(current.observedAtUtc ?? current.fetchedAtUtc);
      if (Number.isFinite(currentTime) && incomingTime < currentTime) return;
    }
    this.usage.set(credentialId, cloneUsageSnapshot({
      ...validated,
      ...(snapshot.observedAtUtc !== undefined ? { observedAtUtc: snapshot.observedAtUtc } : {}),
      ...(snapshot.basis !== undefined ? { basis: snapshot.basis } : {}),
    }));
  }

  /** Explain whether a credential has usable quota evidence for this request. */
  public usageDecision(request: RouteRequest, credentialId: string): CredentialUsageDecision {
    const snapshot = this.usage.get(credentialId);
    if (!snapshot) return usageDecisionResult("unknown", "missing-usage", null, []);
    const fetchedAt = Date.parse(snapshot.fetchedAtUtc);
    const observedAt = snapshot.observedAtUtc === undefined ? fetchedAt : Date.parse(snapshot.observedAtUtc);
    const now = this.now();
    if (snapshot.stale === true || snapshot.basis === "estimated" || !Number.isFinite(fetchedAt) || !Number.isFinite(observedAt)
      || fetchedAt > now || observedAt > now || observedAt > fetchedAt || now - observedAt > this.usageMaxAgeMs) {
      return usageDecisionResult("unknown", "stale-usage", null, []);
    }
    if (snapshot.status !== "ok") return usageDecisionResult("unknown", "unavailable-usage", null, []);
    const providerId = normalizeProviderId(request.providerId);
    const modelId = normalizeModelId(request.modelId);
    const modelFamily = request.modelFamily === undefined ? null : normalizeModelId(request.modelFamily);
    const applicable = snapshot.windows.filter((window) => window.scope === "account"
      || (window.scope === "model-family" && modelFamily !== null && window.modelFamilies.includes(modelFamily))
      || (window.scope === "model" && window.modelFamilies.includes(modelId)));
    const credential = this.credentials.get(credentialId);
    if (!credential || snapshot.providerId !== providerId || credential.providerId !== providerId || !credential.modelIds.includes(modelId)) {
      return usageDecisionResult("unknown", "no-applicable-window", null, []);
    }
    if (applicable.length === 0) return usageDecisionResult("unknown", "no-applicable-window", null, []);
    const active = applicable.filter((window) => window.resetAt === null || window.resetAt > this.now());
    const exhausted = active.filter((window) => window.status === "exhausted" && window.reliability === "high");
    if (exhausted.length > 0) return usageDecisionResult("exhausted", "confirmed-exhaustion", null, exhausted.map((window) => window.id));
    const remaining = active.flatMap((window) => {
      if (window.status !== "known" || window.reliability !== "high") return [];
      const ratio = usageWindowRemainingRatio(window);
      return ratio === null ? [] : [ratio];
    });
    if (remaining.length === 0) return usageDecisionResult("unknown", "unknown-window", null, applicable.map((window) => window.id));
    return usageDecisionResult("available", "fresh-usage", Math.min(...remaining), applicable.map((window) => window.id));
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
    const retryAfterMs = rateLimited && error.kind === "http" && typeof error.retryAfterMs === "number" && Number.isFinite(error.retryAfterMs) && error.retryAfterMs > 0
      ? error.retryAfterMs
      : null;
    const until = new Date(this.now() + Math.min(maximum, retryAfterMs ?? base * (2 ** Math.min(failureCount - 1, 3)))).toISOString();
    this.cooldownReasons.set(credentialId, rateLimited ? "rate-limited" : "transient");
    this.credentials.set(credentialId, { ...current, health: "cooling-down", cooldownUntilUtc: until });
  }

  public health(credentialId: string): CredentialHealthSummary | null {
    this.pruneExpired();
    const current = this.credentials.get(credentialId);
    if (!current) return null;
    const reason = current.health === "cooling-down" ? this.cooldownReasons.get(credentialId) : undefined;
    return { health: current.health, cooldownUntilUtc: current.cooldownUntilUtc, ...(reason ? { cooldownReason: reason } : {}) };
  }

  public remove(credentialId: string): void {
    this.credentials.delete(credentialId);
    this.usage.delete(credentialId);
    this.cooldownReasons.delete(credentialId);
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

  private quotaOrdered(eligible: CredentialMetadata[], remaining: ReadonlyMap<string, number>, key: string): CredentialMetadata[] {
    const groups = new Map<number, CredentialMetadata[]>();
    for (const credential of eligible) {
      const ratio = remaining.get(credential.id)!;
      const group = groups.get(ratio) ?? [];
      group.push(credential);
      groups.set(ratio, group);
    }
    const start = this.cursor.get(key) ?? 0;
    this.cursor.set(key, start + 1);
    return [...groups.entries()].sort(([left], [right]) => right - left).flatMap(([, group]) => {
      const offset = start % group.length;
      return [...group.slice(offset), ...group.slice(0, offset)];
    });
  }
}

function usageDecisionResult(
  status: CredentialUsageDecision["status"],
  reason: CredentialUsageDecision["reason"],
  remainingRatio: number | null,
  windowIds: readonly string[],
): CredentialUsageDecision {
  return { status, reason, remainingRatio, windowIds: [...windowIds] };
}

function cloneUsageSnapshot(snapshot: ProviderUsageSnapshot): ProviderUsageSnapshot {
  return {
    ...snapshot,
    windows: snapshot.windows.map((window) => ({ ...window, modelFamilies: [...window.modelFamilies] })),
    balance: snapshot.balance ? { ...snapshot.balance } : null,
    ...(snapshot.extraUsage ? { extraUsage: { ...snapshot.extraUsage } } : {}),
    ...(snapshot.estimate ? { estimate: { ...snapshot.estimate } } : {}),
  };
}

function usageWindowRemainingRatio(window: ProviderUsageWindow): number | null {
  if (typeof window.remainingPercent === "number") return Math.max(0, Math.min(1, window.remainingPercent / 100));
  if (typeof window.usedRatio === "number") return Math.max(0, Math.min(1, 1 - window.usedRatio));
  if (typeof window.remaining === "number" && typeof window.limit === "number" && window.limit > 0) return Math.max(0, Math.min(1, window.remaining / window.limit));
  if (typeof window.used === "number" && typeof window.limit === "number" && window.limit > 0) return Math.max(0, Math.min(1, 1 - window.used / window.limit));
  return null;
}

function validateStrategy(strategy: RouteStrategy): void {
  if (strategy !== "round-robin" && strategy !== "failover") throw new Error("invalid route strategy");
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

export type ProviderUsageWindowScope = "account" | "model-family" | "model";
export type ProviderUsageWindowStatus = "known" | "unknown" | "exhausted";
export type ProviderUsageWindowReliability = "high" | "low";
export type ProviderUsageWindowKind = "session" | "daily" | "weekly" | "monthly";
export type ProviderUsageErrorCode = "signed-out" | "rate-limited" | "server-error" | "unreadable" | "unreachable" | "no-limits";

export interface ProviderUsageWindow {
  readonly id: string;
  readonly label: string;
  readonly scope: ProviderUsageWindowScope;
  readonly modelFamilies: readonly string[];
  readonly status: ProviderUsageWindowStatus;
  readonly usedRatio: number | null;
  readonly reliability: ProviderUsageWindowReliability;
  /** Derived from the window duration; null when the duration is unknown. */
  readonly kind: ProviderUsageWindowKind | null;
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
  /** False for a pool that was never funded; absent when the provider cannot tell. */
  readonly funded?: boolean;
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

/** Pay-as-you-go spend beyond the plan limits; amounts are in major currency units. */
export interface ProviderUsageExtraUsage {
  readonly enabled: boolean;
  readonly used: number | null;
  readonly limit: number | null;
  readonly usedPercent: number | null;
  readonly currency: string | null;
}

export interface ProviderUsageSnapshot {
  readonly providerId: string;
  readonly credentialId: string;
  readonly status: ProviderUsageStatus;
  readonly plan: string | null;
  readonly planMultiplier?: number | null;
  /** Provider tier value as reported, kept when it has no numeric multiplier. */
  readonly planTier?: string | null;
  readonly billingInterval?: string | null;
  readonly subscriptionRenewsAt?: number | null;
  readonly subscriptionExpiresAt?: number | null;
  readonly metadataError?: string | null;
  readonly windows: readonly ProviderUsageWindow[];
  readonly balance: ProviderUsageBalance | null;
  /** Null when the provider reports no extra-usage block. */
  readonly extraUsage?: ProviderUsageExtraUsage | null;
  readonly estimate?: ProviderUsageEstimate | null;
  /** Organization or account id used to keep cached readings from crossing accounts. */
  readonly identity?: string | null;
  readonly fetchedAtUtc: string;
  readonly error: string | null;
  readonly errorCode?: ProviderUsageErrorCode | null;
  /** Server-provided Retry-After in milliseconds on a rate-limit or server failure; the usage gate backs the provider off for it. */
  readonly retryAfterMs?: number;
  /** True when the windows come from an earlier successful reading. */
  readonly stale?: boolean;
  /** "accurate" when every window is carried as read; "estimated" when any window was rolled past its reset. */
  readonly basis?: ProviderUsageBasis;
  /** When the carried reading was actually observed; absent on a fresh reading, where fetchedAtUtc is the observation. */
  readonly observedAtUtc?: string;
}

export type ProviderUsageBasis = "accurate" | "estimated";

export type UsageHttpClass = "ok" | "signed-out" | "rate-limited" | "server-error";

/** Redirects and 401/403 mean the credential was rejected; 5xx never does. */
export function classifyUsageHttp(status: number): UsageHttpClass {
  if (status >= 200 && status < 300) return "ok";
  if ((status >= 300 && status < 400) || status === 401 || status === 403) return "signed-out";
  if (status === 429) return "rate-limited";
  return "server-error";
}

export type UsageRemedy = "reauth" | "retry" | null;

export function usageRemedy(code: ProviderUsageErrorCode | null | undefined): UsageRemedy {
  if (code === "signed-out") return "reauth";
  if (code === "rate-limited" || code === "server-error" || code === "unreadable" || code === "unreachable") return "retry";
  return null;
}

const NO_RESET_WINDOW_TTL_MS = 24 * 3600 * 1000;

/** Moves a window whose reset has passed into the current cycle as a low-reliability lower bound. */
function rollWindow(window: ProviderUsageWindow, now: number): ProviderUsageWindow {
  const span = (window.windowSeconds as number) * 1000;
  const cycles = Math.floor((now - (window.resetAt as number)) / span) + 1;
  return {
    ...window,
    status: "unknown",
    usedRatio: null,
    usedPercent: 0,
    remainingPercent: null,
    used: null,
    remaining: null,
    reliability: "low",
    resetAt: (window.resetAt as number) + cycles * span,
  };
}

/** Keep the last good reading, marked stale, when the new reading failed. */
export function mergeUsageReading(
  previous: ProviderUsageSnapshot | null | undefined,
  next: ProviderUsageSnapshot,
  now: number,
): ProviderUsageSnapshot {
  if (next.status !== "error") return next;
  if (!previous || previous.status === "error" || previous.providerId !== next.providerId || previous.credentialId !== next.credentialId) return next;
  if (previous.identity && next.identity && previous.identity !== next.identity) return next;
  const observedAtUtc = previous.observedAtUtc ?? previous.fetchedAtUtc;
  const observedAt = Date.parse(observedAtUtc);
  let rolled = previous.basis === "estimated";
  const windows = previous.windows.flatMap((window): ProviderUsageWindow[] => {
    if (window.resetAt === null) return Number.isFinite(observedAt) && now - observedAt <= NO_RESET_WINDOW_TTL_MS ? [window] : [];
    if (window.resetAt > now) return [window];
    if (typeof window.windowSeconds !== "number" || !Number.isFinite(window.windowSeconds) || window.windowSeconds <= 0) return [];
    rolled = true;
    return [rollWindow(window, now)];
  });
  return {
    ...previous,
    windows,
    stale: true,
    basis: rolled ? "estimated" : "accurate",
    observedAtUtc,
    error: next.error,
    errorCode: next.errorCode ?? null,
    ...(next.retryAfterMs !== undefined ? { retryAfterMs: next.retryAfterMs } : {}),
  };
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const SHORT_DAYS = "Mon|Tue|Wed|Thu|Fri|Sat|Sun";
const LONG_DAYS = "Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday";
const MONTH_NAMES = MONTHS.join("|");
const IMF_FIXDATE = new RegExp(`^(?:${SHORT_DAYS}), (\\d{2}) (${MONTH_NAMES}) (\\d{4}) (\\d{2}):(\\d{2}):(\\d{2}) GMT$`);
const RFC850_DATE = new RegExp(`^(?:${LONG_DAYS}), (\\d{2})-(${MONTH_NAMES})-(\\d{2}) (\\d{2}):(\\d{2}):(\\d{2}) GMT$`);
const ASCTIME_DATE = new RegExp(`^(?:${SHORT_DAYS}) (${MONTH_NAMES}) ([ \\d]\\d) (\\d{2}):(\\d{2}):(\\d{2}) (\\d{4})$`);

/** UTC time for the given fields, or null when they do not name a real date and time. */
function utcFields(year: number, month: string, day: number, hour: number, minute: number, second: number): number | null {
  const monthIndex = MONTHS.indexOf(month);
  const time = Date.UTC(year, monthIndex, day, hour, minute, second);
  const check = new Date(time);
  return check.getUTCFullYear() === year && check.getUTCMonth() === monthIndex
    && check.getUTCHours() === hour && check.getUTCMinutes() === minute && check.getUTCSeconds() === second ? time : null;
}

/** Parses the three HTTP-date formats of RFC 9110 section 5.6.7, all in UTC; null for anything else. */
function parseHttpDate(text: string, now: number): number | null {
  let match = IMF_FIXDATE.exec(text);
  if (match) return utcFields(Number(match[3]), match[2]!, Number(match[1]), Number(match[4]), Number(match[5]), Number(match[6]));
  match = RFC850_DATE.exec(text);
  if (match) {
    // A two-digit year more than 50 years ahead means the most recent past year with those digits.
    const currentYear = new Date(now).getUTCFullYear();
    let year = currentYear - (currentYear % 100) + Number(match[3]);
    if (year > currentYear + 50) year -= 100;
    return utcFields(year, match[2]!, Number(match[1]), Number(match[4]), Number(match[5]), Number(match[6]));
  }
  match = ASCTIME_DATE.exec(text);
  if (match) return utcFields(Number(match[6]), match[1]!, Number(match[2]!.trim()), Number(match[3]), Number(match[4]), Number(match[5]));
  return null;
}

/** Delay in milliseconds from a Retry-After header (RFC 9110 section 10.2.3): delay-seconds or an HTTP-date; null when unusable. */
export function parseRetryAfter(value: string | null | undefined, now: number = Date.now()): number | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  if (/^\d+$/.test(text)) {
    const seconds = Number(text);
    return Number.isFinite(seconds) ? seconds * 1000 : null;
  }
  const date = parseHttpDate(text, now);
  return date === null ? null : Math.max(0, date - now);
}

export interface OAuthRenewalSlot {
  readonly expires: number;
  readonly accountId?: string;
}

export interface OAuthTombstone {
  readonly tombstone: true;
}

export const OAUTH_TOMBSTONE: OAuthTombstone = Object.freeze({ tombstone: true });

export function isOAuthTombstone(value: unknown): value is OAuthTombstone {
  return typeof value === "object" && value !== null && (value as { tombstone?: unknown }).tombstone === true;
}

/** Compare-and-set rule for storing a refreshed credential; logout deletes without it. */
export function acceptsRenewal(existing: OAuthRenewalSlot | OAuthTombstone | null | undefined, next: OAuthRenewalSlot): boolean {
  if (!existing || isOAuthTombstone(existing)) return false;
  return next.expires > existing.expires && next.accountId === existing.accountId;
}

export interface RefreshGate {
  run<T>(credentialId: string, task: () => Promise<T>): Promise<T>;
}

/** Runs one refresh per credential id at a time; concurrent callers share its result. */
export function createRefreshGate(): RefreshGate {
  const running = new Map<string, Promise<unknown>>();
  return {
    run<T>(credentialId: string, task: () => Promise<T>): Promise<T> {
      const current = running.get(credentialId);
      if (current) return current as Promise<T>;
      const promise = (async () => task())().finally(() => { if (running.get(credentialId) === promise) running.delete(credentialId); });
      running.set(credentialId, promise);
      return promise;
    },
  };
}

export type UsageReadReason = "timer" | "view" | "manual" | "credential-changed";

export interface UsageGateLanePolicy {
  /** Reads of this provider that may run at the same time. */
  readonly concurrency: number;
  /** Minimum time between two read starts of this provider. */
  readonly minSpacingMs: number;
}

export interface UsageGatePolicy {
  /** Minimum time since the last read of the same credential started, for the given reason. */
  minIntervalMs(providerId: string, reason: UsageReadReason): number;
  lane?(providerId: string): UsageGateLanePolicy;
  /** Reads that may run at the same time across all providers. */
  readonly maxConcurrent?: number;
  /** Maximum queued credentials. Defaults to 256. */
  readonly maxQueueSize?: number;
  /** Maximum time a request may wait in the queue. Defaults to two minutes. */
  readonly queueTimeoutMs?: number;
  /** Maximum task duration. Defaults to two minutes. */
  readonly executionTimeoutMs?: number;
  readonly now?: () => number;
  /** Wait function used for provider start spacing, including deterministic clocks. */
  readonly sleep?: (ms: number) => Promise<void>;
  /** Random source in [0, 1) for backoff jitter. */
  readonly random?: () => number;
}

export interface UsageGateRequest {
  readonly providerId: string;
  readonly reason: UsageReadReason;
}

export interface UsageGateRunOptions {
  readonly signal?: AbortSignal;
}

export type UsageGateResult<T> =
  | { readonly ran: true; readonly value: T; readonly retryAt: number | null }
  | { readonly ran: false; readonly retryAt: number | null; readonly status?: "cancelled" | "timed-out" | "queue-full" };

export interface UsageGate {
  run<T>(credentialId: string, request: UsageGateRequest, task: (signal: AbortSignal) => Promise<T>, options?: UsageGateRunOptions): Promise<UsageGateResult<T>>;
  /** Cancels queued timer/view requests; active reads are left to settle. */
  cancelPendingBackground(): number;
}

const BACKOFF_BASE_MS = 60_000;
const BACKOFF_CAP_MS = 30 * 60_000;
const RETRY_AFTER_CAP_MS = 60 * 60_000;
const BACKOFF_JITTER_MS = 5000;
const USAGE_GATE_DEFAULT_MAX_QUEUE = 256;
const USAGE_GATE_DEFAULT_QUEUE_TIMEOUT_MS = 2 * 60_000;
const USAGE_GATE_DEFAULT_EXECUTION_TIMEOUT_MS = 2 * 60_000;
const USAGE_GATE_MAX_SUBSCRIBERS = 64;

interface UsageLane {
  running: number;
  lastStartAt: number;
  retryNotBefore: number;
  failures: number;
  lastFailureAt: number;
}

interface UsageFailureSignal {
  readonly retryAfterMs: number | null;
}

interface UsageGateFailure {
  readonly reason: unknown;
}

interface UsageGateSubscriber<T> {
  resolve(result: UsageGateResult<T>): void;
  reject(error: unknown): void;
  signal?: AbortSignal;
  abort?: () => void;
  settled: boolean;
}

interface UsageGateJob<T = unknown> {
  credentialId: string;
  request: UsageGateRequest;
  task: (signal: AbortSignal) => Promise<T>;
  notBefore?: number;
  sequence: number;
  subscribers: UsageGateSubscriber<T>[];
  queueTimer?: ReturnType<typeof setTimeout>;
  state: "queued" | "running";
  controller?: AbortController;
  timeoutTimer?: ReturnType<typeof setTimeout>;
  timedOut?: boolean;
}

/** A rate-limit or server failure, thrown as an error with a code or returned as a snapshot with an errorCode. */
function usageFailureSignal(value: unknown): UsageFailureSignal | null {
  if (!value || typeof value !== "object") return null;
  const source = value as { code?: unknown; errorCode?: unknown; retryAfterMs?: unknown };
  const code = source.code ?? source.errorCode;
  if (code !== "rate-limited" && code !== "server-error") return null;
  const retryAfterMs = typeof source.retryAfterMs === "number" && Number.isFinite(source.retryAfterMs) && source.retryAfterMs >= 0 ? source.retryAfterMs : null;
  return { retryAfterMs };
}

const USAGE_REASON_PRIORITY: Record<UsageReadReason, number> = {
  timer: 0,
  view: 1,
  manual: 2,
  "credential-changed": 3,
};

function finiteNonNegative(value: number, name: string): void {
  if (!Number.isFinite(value) || value < 0) throw new RangeError(`${name} must be finite and non-negative`);
}

/** Schedules bounded usage reads with priority, per-provider limits, spacing, and backoff. */
export function createUsageGate(policy: UsageGatePolicy): UsageGate {
  const now = policy.now ?? Date.now;
  const random = policy.random ?? Math.random;
  const maxConcurrent = policy.maxConcurrent ?? 8;
  const maxQueueSize = policy.maxQueueSize ?? USAGE_GATE_DEFAULT_MAX_QUEUE;
  const queueTimeoutMs = policy.queueTimeoutMs ?? USAGE_GATE_DEFAULT_QUEUE_TIMEOUT_MS;
  const executionTimeoutMs = policy.executionTimeoutMs ?? USAGE_GATE_DEFAULT_EXECUTION_TIMEOUT_MS;
  if (!Number.isInteger(maxConcurrent) || maxConcurrent < 1) throw new RangeError("maxConcurrent must be a positive integer");
  if (!Number.isInteger(maxQueueSize) || maxQueueSize < 1) throw new RangeError("maxQueueSize must be a positive integer");
  finiteNonNegative(queueTimeoutMs, "queueTimeoutMs");
  if (!Number.isFinite(executionTimeoutMs) || executionTimeoutMs <= 0) throw new RangeError("executionTimeoutMs must be positive and finite");
  if (typeof policy.minIntervalMs !== "function") throw new TypeError("minIntervalMs must be a function");

  const queue: UsageGateJob[] = [];
  const active = new Map<string, UsageGateJob>();
  const pending = new Map<string, UsageGateJob>();
  const lanes = new Map<string, UsageLane>();
  const lastStart = new Map<string, number>();
  let running = 0;
  let sequence = 0;
  let pumpTimer: ReturnType<typeof setTimeout> | undefined;
  const waitingProviders = new Map<string, object>();

  const laneOf = (providerId: string): UsageLane => {
    let lane = lanes.get(providerId);
    if (!lane) {
      lane = { running: 0, lastStartAt: -Infinity, retryNotBefore: 0, failures: 0, lastFailureAt: -Infinity };
      lanes.set(providerId, lane);
    }
    return lane;
  };
  const backingOffUntil = (lane: UsageLane): number | null => lane.retryNotBefore > now() ? lane.retryNotBefore : null;
  const recordFailure = (lane: UsageLane, signal: UsageFailureSignal, startedAt: number) => {
    if (signal.retryAfterMs === null && startedAt > lane.lastFailureAt) lane.failures += 1;
    lane.lastFailureAt = now();
    const delay = signal.retryAfterMs !== null
      ? Math.min(signal.retryAfterMs, RETRY_AFTER_CAP_MS)
      : Math.min(BACKOFF_BASE_MS * 2 ** Math.min(Math.max(lane.failures - 1, 0), 16), BACKOFF_CAP_MS);
    lane.retryNotBefore = Math.max(lane.retryNotBefore, now() + delay + random() * BACKOFF_JITTER_MS);
  };
  const priority = (job: UsageGateJob) => USAGE_REASON_PRIORITY[job.request.reason];
  const settleSubscriber = <T>(subscriber: UsageGateSubscriber<T>, result: UsageGateResult<T>, failure?: UsageGateFailure) => {
    if (subscriber.settled) return;
    subscriber.settled = true;
    if (subscriber.abort && subscriber.signal) subscriber.signal.removeEventListener("abort", subscriber.abort);
    if (failure) subscriber.reject(failure.reason);
    else subscriber.resolve(result);
  };
  const settleJob = <T>(job: UsageGateJob<T>, result: UsageGateResult<T>, failure?: UsageGateFailure) => {
    if (job.queueTimer) clearTimeout(job.queueTimer);
    if (job.timeoutTimer) clearTimeout(job.timeoutTimer);
    for (const subscriber of job.subscribers) settleSubscriber(subscriber, result, failure);
    job.subscribers.length = 0;
    if (job.state === "queued") {
      const index = queue.indexOf(job);
      if (index >= 0) queue.splice(index, 1);
      if (pending.get(job.credentialId) === job) pending.delete(job.credentialId);
      if (!queue.some((queued) => queued.request.providerId === job.request.providerId)) waitingProviders.delete(job.request.providerId);
      if (queue.length === 0 && pumpTimer) { clearTimeout(pumpTimer); pumpTimer = undefined; }
    }
  };
  const schedulePump = (delay = 0) => {
    if (pumpTimer) clearTimeout(pumpTimer);
    pumpTimer = setTimeout(() => { pumpTimer = undefined; pump(); }, delay);
  };
  const waitForProvider = (providerId: string, delay: number) => {
    if (!policy.sleep || waitingProviders.has(providerId)) return;
    const waitToken = {};
    waitingProviders.set(providerId, waitToken);
    const rejectWait = (error: unknown) => {
      if (waitingProviders.get(providerId) !== waitToken) return;
      waitingProviders.delete(providerId);
      for (const job of [...queue]) if (job.request.providerId === providerId) settleJob(job, { ran: false, retryAt: null }, { reason: error });
      pump();
    };
    let waiting: Promise<void>;
    try {
      waiting = policy.sleep(delay);
    } catch (error) {
      rejectWait(error);
      return;
    }
    void Promise.resolve(waiting).then(() => {
      if (waitingProviders.get(providerId) !== waitToken) return;
      waitingProviders.delete(providerId);
      pump();
    }, rejectWait);
  };
  const finish = <T>(job: UsageGateJob<T>, result: UsageGateResult<T>, failure?: UsageGateFailure) => {
    if (active.get(job.credentialId) === job) active.delete(job.credentialId);
    const lane = laneOf(job.request.providerId);
    lane.running -= 1;
    running -= 1;
    settleJob(job, result, failure);
    pump();
  };

  const start = <T>(job: UsageGateJob<T>) => {
    const lane = laneOf(job.request.providerId);
    const limits = policy.lane?.(job.request.providerId) ?? { concurrency: maxConcurrent, minSpacingMs: 0 };
    if (!Number.isInteger(limits.concurrency) || limits.concurrency < 1) throw new RangeError("lane concurrency must be a positive integer");
    finiteNonNegative(limits.minSpacingMs, "lane minSpacingMs");
    const blocked = backingOffUntil(lane);
    if (blocked !== null) { settleJob(job, { ran: false, retryAt: blocked }); return; }
    const previous = lastStart.get(job.credentialId);
    const interval = policy.minIntervalMs(job.request.providerId, job.request.reason);
    finiteNonNegative(interval, "minIntervalMs");
    if (previous !== undefined && previous + interval > now()) {
      settleJob(job, { ran: false, retryAt: previous + interval });
      return;
    }
    const spacingAt = lane.lastStartAt + limits.minSpacingMs;
    if (spacingAt > now()) {
      const delay = spacingAt - now();
      if (policy.sleep) waitForProvider(job.request.providerId, delay);
      else schedulePump(delay);
      return;
    }
    if (lane.running >= limits.concurrency || running >= maxConcurrent) return;

    job.state = "running";
    const queueIndex = queue.indexOf(job);
    if (queueIndex >= 0) queue.splice(queueIndex, 1);
    if (job.queueTimer) clearTimeout(job.queueTimer);
    pending.delete(job.credentialId);
    active.set(job.credentialId, job);
    lane.running += 1;
    running += 1;
    const startedAt = now();
    lane.lastStartAt = startedAt;
    lastStart.set(job.credentialId, startedAt);
    const controller = new AbortController();
    job.controller = controller;
    job.timeoutTimer = setTimeout(() => {
      job.timedOut = true;
      controller.abort("usage refresh timed out");
      for (const subscriber of job.subscribers) settleSubscriber(subscriber, { ran: false, retryAt: null, status: "timed-out" });
      job.subscribers.length = 0;
      // Keep the slot until the callback settles, even when it ignores abort.
    }, executionTimeoutMs);
    Promise.resolve().then(() => job.task(controller.signal)).then((value) => {
      const signal = usageFailureSignal(value);
      if (signal) {
        recordFailure(lane, signal, startedAt);
        finish(job, { ran: true, value, retryAt: backingOffUntil(lane) });
      } else {
        if (startedAt > lane.lastFailureAt) { lane.failures = 0; lane.retryNotBefore = 0; }
        finish(job, { ran: true, value, retryAt: null });
      }
    }, (error) => {
      const signal = usageFailureSignal(error);
      if (signal) recordFailure(lane, signal, startedAt);
      finish(job, { ran: false, retryAt: backingOffUntil(lane) }, { reason: error });
    });
  };

  function pump() {
    if (running >= maxConcurrent || queue.length === 0) return;
    queue.sort((a, b) => priority(b) - priority(a) || a.sequence - b.sequence);
    let nextDelay = Infinity;
    for (const job of [...queue]) {
      if (pending.get(job.credentialId) !== job) continue;
      if (active.has(job.credentialId)) continue;
      const lane = laneOf(job.request.providerId);
      let limits: UsageGateLanePolicy;
      let interval: number;
      try {
        limits = policy.lane?.(job.request.providerId) ?? { concurrency: maxConcurrent, minSpacingMs: 0 };
        interval = policy.minIntervalMs(job.request.providerId, job.request.reason);
        if (!Number.isInteger(limits.concurrency) || limits.concurrency < 1) throw new RangeError("lane concurrency must be a positive integer");
        finiteNonNegative(limits.minSpacingMs, "lane minSpacingMs");
        finiteNonNegative(interval, "minIntervalMs");
      } catch (error) {
        settleJob(job, { ran: false, retryAt: null }, { reason: error });
        continue;
      }
      const blockedUntil = backingOffUntil(lane);
      if (blockedUntil !== null) { settleJob(job, { ran: false, retryAt: blockedUntil }); continue; }
      if (waitingProviders.has(job.request.providerId)) continue;
      const previous = lastStart.get(job.credentialId);
      const credentialReady = previous === undefined ? now() : previous + interval;
      if (credentialReady > now()) { settleJob(job, { ran: false, retryAt: credentialReady }); continue; }
      if (lane.running >= limits.concurrency || running >= maxConcurrent) continue;
      const providerReady = Math.max(lane.lastStartAt + limits.minSpacingMs, job.notBefore ?? now());
      if (providerReady > now()) {
        job.notBefore = providerReady;
        nextDelay = Math.min(nextDelay, providerReady - now());
        if (policy.sleep) {
          waitForProvider(job.request.providerId, providerReady - now());
        }
        continue;
      }
      delete job.notBefore;
      try { start(job); } catch (error) { settleJob(job, { ran: false, retryAt: null }, { reason: error }); }
      if (running >= maxConcurrent) break;
    }
    if (queue.length && Number.isFinite(nextDelay) && !policy.sleep) schedulePump(nextDelay);
  }

  const enqueue = <T>(credentialId: string, request: UsageGateRequest, task: (signal: AbortSignal) => Promise<T>, options?: UsageGateRunOptions): Promise<UsageGateResult<T>> => {
    if (typeof credentialId !== "string" || !credentialId.trim()) throw new TypeError("credentialId must be a non-empty string");
    if (!request || typeof request.providerId !== "string" || !request.providerId.trim()) throw new TypeError("providerId must be a non-empty string");
    if (!Object.hasOwn(USAGE_REASON_PRIORITY, request.reason)) throw new TypeError("invalid usage read reason");
    if (typeof task !== "function") throw new TypeError("task must be a function");
    const normalizedRequest: UsageGateRequest = Object.freeze({ providerId: request.providerId, reason: request.reason });
    if (options?.signal?.aborted) return Promise.resolve({ ran: false, retryAt: null, status: "cancelled" });

    const activeJob = active.get(credentialId);
    const queuedJob = pending.get(credentialId);
    const reusableActive = activeJob && !activeJob.controller?.signal.aborted ? activeJob : undefined;
    const existing = queuedJob ?? reusableActive;
    if ((activeJob && activeJob.request.providerId !== normalizedRequest.providerId) || (queuedJob && queuedJob.request.providerId !== normalizedRequest.providerId)) return Promise.reject(new Error("credentialId is already scheduled for another provider"));
    if (activeJob?.timedOut && !queuedJob && normalizedRequest.reason !== "credential-changed") return Promise.resolve({ ran: false, retryAt: null, status: "timed-out" });
    if (existing && normalizedRequest.reason !== "credential-changed") {
      if (existing.state === "queued" && priority({ ...existing, request: normalizedRequest }) > priority(existing)) existing.request = normalizedRequest;
      return subscribe(existing as UsageGateJob<T>, options?.signal);
    }
    if (existing && normalizedRequest.reason === "credential-changed" && existing.state === "queued") {
      settleJob(existing, { ran: false, retryAt: null, status: "cancelled" });
    }
    if (existing && normalizedRequest.reason === "credential-changed" && existing.state === "running") {
      const queued = pending.get(credentialId);
      if (queued) {
        settleJob(queued, { ran: false, retryAt: null, status: "cancelled" });
      }
    }
    const currentQueued = pending.get(credentialId);
    if (currentQueued && normalizedRequest.reason !== "credential-changed") return subscribe(currentQueued as UsageGateJob<T>, options?.signal);
    if (queue.length >= maxQueueSize) return Promise.resolve({ ran: false, retryAt: null, status: "queue-full" });
    const job: UsageGateJob<T> = { credentialId, request: normalizedRequest, task, sequence: sequence++, subscribers: [], state: "queued" };
    pending.set(credentialId, job);
    queue.push(job);
    job.queueTimer = setTimeout(() => settleJob(job, { ran: false, retryAt: null, status: "timed-out" }), queueTimeoutMs);
    const result = subscribe(job, options?.signal);
    pump();
    return result;
  };
  const subscribe = <T>(job: UsageGateJob<T>, signal?: AbortSignal): Promise<UsageGateResult<T>> => {
    if (job.subscribers.length >= USAGE_GATE_MAX_SUBSCRIBERS) return Promise.resolve({ ran: false, retryAt: null, status: "queue-full" });
    return new Promise((resolve, reject) => {
    const subscriber: UsageGateSubscriber<T> = { resolve, reject, ...(signal ? { signal } : {}), settled: false };
    if (signal) {
      subscriber.abort = () => {
        settleSubscriber(subscriber, { ran: false, retryAt: null, status: "cancelled" });
        const index = job.subscribers.indexOf(subscriber);
        if (index >= 0) job.subscribers.splice(index, 1);
        if (job.state === "queued" && job.subscribers.length === 0) settleJob(job, { ran: false, retryAt: null, status: "cancelled" });
        if (job.state === "running" && job.subscribers.length === 0) job.controller?.abort("all callers cancelled");
      };
      signal.addEventListener("abort", subscriber.abort, { once: true });
    }
    job.subscribers.push(subscriber);
    if (signal?.aborted) subscriber.abort?.();
    });
  };

  return {
    run: enqueue,
    cancelPendingBackground(): number {
      const background = queue.filter((job) => job.request.reason === "timer" || job.request.reason === "view");
      for (const job of background) settleJob(job, { ran: false, retryAt: null, status: "cancelled" });
      return background.length;
    },
  };
}

/** Numeric multiplier encoded in a tier name such as "default_claude_max_5x". */
export function planMultiplierFromTier(tier: unknown): number | null {
  if (typeof tier !== "string") return null;
  const match = /(?:^|[^a-z0-9])(\d{1,3})x(?:$|[^a-z0-9])/i.exec(tier);
  return match ? Number(match[1]) : null;
}

const CODEX_PLAN_ALIASES: Readonly<Record<string, { plan: string; multiplier: number | null }>> = {
  prolite: { plan: "pro", multiplier: 5 },
  pro_lite: { plan: "pro", multiplier: 5 },
  "pro-lite": { plan: "pro", multiplier: 5 },
  "pro lite": { plan: "pro", multiplier: 5 },
  pro: { plan: "pro", multiplier: 10 },
  promax: { plan: "pro", multiplier: 25 },
  team: { plan: "business", multiplier: null },
  teams: { plan: "business", multiplier: null },
  business: { plan: "business", multiplier: null },
  self_serve_business_usage_based: { plan: "business", multiplier: null },
  enterprise: { plan: "enterprise", multiplier: null },
  enterprise_cbp_usage_based: { plan: "enterprise", multiplier: null },
  free: { plan: "free", multiplier: null },
  go: { plan: "go", multiplier: null },
  plus: { plan: "plus", multiplier: null },
  edu: { plan: "edu", multiplier: null },
};

/** Canonical Codex plan, its usage multiplier and tier key; unknown names pass through and anything containing "@" is dropped. */
export function normalizeCodexPlan(value: unknown): { plan: string | null; multiplier: number | null; tier: string | null } {
  if (typeof value !== "string" || !value.trim() || value.includes("@")) return { plan: null, multiplier: null, tier: null };
  const raw = value.trim();
  const alias = CODEX_PLAN_ALIASES[raw.toLowerCase()];
  if (!alias && /^pro(?![a-z0-9])/i.test(raw)) {
    const sized = planMultiplierFromTier(raw);
    if (sized !== null && sized >= 1 && sized <= 100) return { plan: "pro", multiplier: sized, tier: codexProTier(sized) };
  }
  const plan = alias?.plan ?? raw;
  const multiplier = alias?.multiplier ?? null;
  return { plan, multiplier, tier: plan === "pro" && multiplier !== null ? codexProTier(multiplier) : plan };
}

function codexProTier(multiplier: number): string {
  return ({ 5: "prolite", 10: "pro", 25: "promax" } as Record<number, string>)[multiplier] ?? `pro_${multiplier}x`;
}

export type OAuthCredentialStatus = "active" | "refresh-needed" | "reauth" | "unknown";

/** Read-only view of an OAuth credential; never contains token values. */
export interface OAuthCredentialView {
  readonly account?: string;
  readonly organization?: string;
  readonly plan?: string;
  readonly planMultiplier?: number;
  readonly tokenExpiresAt?: number;
  readonly refreshExpiresAt?: number;
  readonly scopes?: readonly string[];
  readonly lastRefreshAt?: number;
  readonly status: OAuthCredentialStatus;
}

interface OAuthFieldMap {
  readonly account: readonly string[];
  readonly organization: readonly string[];
  readonly plan: readonly string[];
  readonly tier: readonly string[];
  readonly expires: readonly string[];
  readonly refreshExpires: readonly string[];
  readonly scopes: readonly string[];
  readonly lastRefresh: readonly string[];
}

const BASE_OAUTH_FIELDS: OAuthFieldMap = {
  account: ["email", "accountEmail", "username", "login"],
  organization: ["organizationName", "organization", "orgName", "organizationId", "organization_id", "orgId"],
  plan: ["subscriptionType", "plan", "planType", "plan_type"],
  tier: ["rateLimitTier", "rate_limit_tier", "tier"],
  expires: ["expires", "expiresAt", "expires_at", "accessExpires"],
  refreshExpires: ["refreshExpires", "refreshExpiresAt", "refresh_expires_at", "refreshTokenExpiresAt"],
  scopes: ["scopes", "scope"],
  lastRefresh: ["lastRefresh", "lastRefreshAt", "last_refresh", "refreshedAt"],
};

const OAUTH_FIELD_OVERRIDES: Readonly<Record<string, Partial<OAuthFieldMap>>> = {
  anthropic: { organization: ["organizationName", "organizationId", "organization_id"], plan: ["subscriptionType"] },
  "openai-codex": { account: ["email", "accountEmail"], plan: ["planType", "plan_type", "plan"] },
  "github-copilot": { account: ["login", "username", "email"], organization: ["enterpriseUrl", "organization"] },
};

function oauthTimestamp(value: unknown): number | undefined {
  const numeric = typeof value === "number" ? value : typeof value === "string" && /^\d+(\.\d+)?$/.test(value.trim()) ? Number(value) : NaN;
  if (Number.isFinite(numeric) && numeric > 0) return numeric < 10_000_000_000 ? numeric * 1000 : numeric;
  const parsed = typeof value === "string" ? Date.parse(value) : NaN;
  return Number.isFinite(parsed) ? parsed : undefined;
}

function jwtClaims(token: unknown): Record<string, unknown> {
  if (typeof token !== "string") return {};
  try {
    const payload = token.split(".")[1];
    if (!payload) return {};
    const parsed: unknown = JSON.parse(globalThis.atob(payload.replace(/-/g, "+").replace(/_/g, "/")));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch { return {}; }
}

/** Parse a stored OAuth credential into a safe display view; unmapped fields are dropped. */
export function describeOAuthCredential(provider: string, credential: unknown, now: number = Date.now()): OAuthCredentialView {
  const source = credential && typeof credential === "object" && !Array.isArray(credential) ? credential as Record<string, unknown> : {};
  const fields: OAuthFieldMap = { ...BASE_OAUTH_FIELDS, ...(OAUTH_FIELD_OVERRIDES[provider] ?? {}) };
  const secrets = new Set(["access", "refresh", "id_token", "idToken", "access_token", "refresh_token"].flatMap((key) => {
    const value = source[key];
    return typeof value === "string" && value ? [value] : [];
  }));
  const text = (value: unknown): string | undefined => {
    if (typeof value !== "string") return undefined;
    const trimmed = value.trim();
    return trimmed && trimmed.length <= 200 && !/\s{2,}|[\u0000-\u001f]/.test(trimmed) && !secrets.has(trimmed) && !/^eyJ[\w-]+\.[\w-]+\./.test(trimmed) ? trimmed : undefined;
  };
  const pick = (names: readonly string[], read: (value: unknown) => unknown = text): unknown => {
    for (const name of names) {
      const value = read(source[name]);
      if (value !== undefined) return value;
    }
    return undefined;
  };
  const claims = provider === "openai-codex" ? jwtClaims(source.access) : {};
  const idClaims = provider === "openai-codex" ? jwtClaims(source.idToken ?? source.id_token) : {};
  const profileClaims = { ...(claims["https://api.openai.com/profile"] as Record<string, unknown>), ...(idClaims["https://api.openai.com/profile"] as Record<string, unknown>) };
  const authClaims = { ...(claims["https://api.openai.com/auth"] as Record<string, unknown>), ...(idClaims["https://api.openai.com/auth"] as Record<string, unknown>) };
  const account = (pick(fields.account) ?? text(idClaims.email) ?? text(profileClaims.email)) as string | undefined;
  const organization = pick(fields.organization) as string | undefined;
  let plan = (pick(fields.plan) ?? text(authClaims.chatgpt_plan_type)) as string | undefined;
  let planMultiplier: number | undefined;
  if (provider === "openai-codex" && plan) {
    const normalized = normalizeCodexPlan(plan);
    plan = normalized.plan ?? undefined;
    if (normalized.multiplier !== null) planMultiplier = normalized.multiplier;
  }
  const tier = pick(fields.tier) as string | undefined;
  if (planMultiplier === undefined && tier) {
    const fromTier = planMultiplierFromTier(tier);
    if (fromTier !== null) planMultiplier = fromTier;
  }
  const scopes = pick(fields.scopes, (value) => {
    const items = Array.isArray(value) ? value : typeof value === "string" ? value.split(/[\s,]+/) : [];
    const safe = [...new Set(items.flatMap((item) => typeof item === "string" && /^[\w:./-]{1,100}$/.test(item) && !secrets.has(item) ? [item] : []))];
    return safe.length ? safe : undefined;
  }) as string[] | undefined;
  const tokenExpiresAt = pick(fields.expires, oauthTimestamp) as number | undefined;
  const refreshExpiresAt = pick(fields.refreshExpires, oauthTimestamp) as number | undefined;
  const lastRefreshAt = pick(fields.lastRefresh, oauthTimestamp) as number | undefined;
  const status: OAuthCredentialStatus = refreshExpiresAt !== undefined && refreshExpiresAt <= now ? "reauth"
    : tokenExpiresAt === undefined ? "unknown"
      : tokenExpiresAt <= now ? "refresh-needed" : "active";
  return {
    ...(account ? { account } : {}),
    ...(organization ? { organization } : {}),
    ...(plan ? { plan } : {}),
    ...(planMultiplier !== undefined ? { planMultiplier } : {}),
    ...(tokenExpiresAt !== undefined ? { tokenExpiresAt } : {}),
    ...(refreshExpiresAt !== undefined ? { refreshExpiresAt } : {}),
    ...(scopes ? { scopes } : {}),
    ...(lastRefreshAt !== undefined ? { lastRefreshAt } : {}),
    status,
  };
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

const USAGE_WINDOW_KINDS: readonly string[] = ["session", "daily", "weekly", "monthly"];
const USAGE_ERROR_CODES: readonly string[] = ["signed-out", "rate-limited", "server-error", "unreadable", "unreachable", "no-limits"];

function validateExtraUsage(extra: ProviderUsageExtraUsage): ProviderUsageExtraUsage {
  const amount = (value: unknown, max = Infinity): boolean => value === null || (typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= max);
  if (!extra || typeof extra !== "object" || typeof extra.enabled !== "boolean"
    || !amount(extra.used) || !amount(extra.limit) || !amount(extra.usedPercent, 100)
    || (extra.currency !== null && (typeof extra.currency !== "string" || !extra.currency.trim()))) {
    throw new Error("adapter returned an invalid extra usage");
  }
  return { enabled: extra.enabled, used: extra.used, limit: extra.limit, usedPercent: extra.usedPercent, currency: extra.currency === null ? null : extra.currency.trim() };
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
    || (snapshot.error !== null && typeof snapshot.error !== "string")
    || (snapshot.planTier !== undefined && snapshot.planTier !== null && typeof snapshot.planTier !== "string")
    || (snapshot.identity !== undefined && snapshot.identity !== null && typeof snapshot.identity !== "string")
    || (snapshot.stale !== undefined && typeof snapshot.stale !== "boolean")
    || (snapshot.errorCode !== undefined && snapshot.errorCode !== null && !USAGE_ERROR_CODES.includes(snapshot.errorCode))) {
    throw new Error("adapter returned an invalid usage snapshot");
  }
  const windows = snapshot.windows.map((window) => {
    if (!window || typeof window !== "object" || typeof window.id !== "string" || !window.id.trim()
      || typeof window.label !== "string" || !window.label.trim()
      || !["account", "model-family", "model"].includes(window.scope)
      || !Array.isArray(window.modelFamilies) || window.modelFamilies.some((family: unknown) => typeof family !== "string" || !family.trim())
      || (window.scope === "account" && window.modelFamilies.length > 0)
      || !["known", "unknown", "exhausted"].includes(window.status)
      || !["high", "low"].includes(window.reliability)
      || (window.kind !== undefined && window.kind !== null && !USAGE_WINDOW_KINDS.includes(window.kind))
      || (window.usedRatio !== null && (typeof window.usedRatio !== "number" || !Number.isFinite(window.usedRatio) || window.usedRatio < 0 || window.usedRatio > 1))
      || (window.status === "unknown") !== (window.usedRatio === null)
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
      scope: window.scope,
      modelFamilies: window.modelFamilies.map((family: string) => family.trim()),
      status: window.status,
      usedRatio: window.usedRatio,
      reliability: window.reliability,
      kind: window.kind ?? null,
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
    && (snapshot.balance.funded === undefined || typeof snapshot.balance.funded === "boolean")
    ? { amount: snapshot.balance.amount, unit: snapshot.balance.unit.trim(), ...(snapshot.balance.funded !== undefined ? { funded: snapshot.balance.funded } : {}) }
    : undefined;
  if (snapshot.balance !== null && !balance) throw new Error("adapter returned an invalid usage balance");
  const estimate = snapshot.estimate === undefined ? undefined : snapshot.estimate === null ? null : validateUsageEstimate(snapshot.estimate);
  const extraUsage = snapshot.extraUsage === undefined || snapshot.extraUsage === null ? snapshot.extraUsage : validateExtraUsage(snapshot.extraUsage);
  return {
    providerId: capability.providerId,
    credentialId: snapshot.credentialId,
    status: snapshot.status,
    plan: snapshot.plan,
    ...(snapshot.planMultiplier !== undefined ? { planMultiplier: snapshot.planMultiplier } : {}),
    ...(snapshot.planTier !== undefined ? { planTier: snapshot.planTier } : {}),
    ...(snapshot.billingInterval !== undefined ? { billingInterval: snapshot.billingInterval } : {}),
    ...(snapshot.subscriptionRenewsAt !== undefined ? { subscriptionRenewsAt: snapshot.subscriptionRenewsAt } : {}),
    ...(snapshot.subscriptionExpiresAt !== undefined ? { subscriptionExpiresAt: snapshot.subscriptionExpiresAt } : {}),
    ...(snapshot.metadataError !== undefined ? { metadataError: safeUsageText(snapshot.metadataError) } : {}),
    windows,
    balance: balance ?? null,
    ...(extraUsage !== undefined ? { extraUsage } : {}),
    ...(estimate !== undefined ? { estimate } : {}),
    ...(snapshot.identity !== undefined ? { identity: snapshot.identity } : {}),
    fetchedAtUtc: snapshot.fetchedAtUtc,
    error: safeUsageText(snapshot.error),
    ...(snapshot.errorCode !== undefined ? { errorCode: snapshot.errorCode } : {}),
    ...(snapshot.stale !== undefined ? { stale: snapshot.stale } : {}),
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
