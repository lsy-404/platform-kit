export const MODEL_AUTH_VERSION = "0.3.0";

export type AuthMethod = "oauth" | "api-key";
export type CredentialHealth = "healthy" | "cooling-down" | "permanently-failed";
export type RouteStrategy = "round-robin" | "weighted-round-robin" | "failover";

export interface ModelDescriptor {
  readonly id: string;
  readonly name: string;
  readonly releaseDate: string | null;
}

export interface ProviderBinding {
  readonly id: string;
  readonly name: string;
  readonly packageName: string | null;
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
      if (!isRecord(model) || model.status === "deprecated" || model.deprecated === true || model.tool_call !== true || !hasTextOutput(model)) return [];
      let modelId: string;
      try { modelId = normalizeModelId(typeof model.id === "string" ? model.id : modelKey); } catch { return []; }
      const modelName = typeof model.name === "string" && model.name.trim() ? model.name.trim() : modelId;
      let releaseDate: string | null = null;
      try { releaseDate = model.release_date === undefined || model.release_date === null ? null : requiredString(model.release_date, `model ${id}/${modelId}.release_date`); } catch { return []; }
      return [{ id: modelId, name: modelName, releaseDate }];
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
    return unique.length > 0 ? [{ id, name, packageName, models: unique }] : [];
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

export function bindRuntimeProviders(catalog: ModelsDevCatalog, bindings: readonly RuntimeProviderBindingInput[]): readonly RuntimeProviderBinding[] {
  return bindings.map((binding) => {
    const provider = providerBinding(catalog, binding.catalogProviderId);
    const models = provider?.models.filter((model) => binding.includeModel === undefined || binding.includeModel(model)) ?? [];
    return { runtimeProviderId: normalizeProviderId(binding.runtimeProviderId), catalogProviderId: provider?.id ?? normalizeProviderId(binding.catalogProviderId), models };
  });
}

function hasTextOutput(model: Record<string, unknown>): boolean {
  const modalities = model.modalities;
  if (isRecord(modalities) && Array.isArray(modalities.output)) return modalities.output.includes("text");
  if (Array.isArray(model.output)) return model.output.includes("text");
  if (Array.isArray(model.output_modalities)) return model.output_modalities.includes("text");
  return false;
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
      models: provider.models.map((model) => ({ ...model })),
    })),
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
}

export interface CredentialInput {
  readonly id: string;
  readonly providerId: string;
  readonly authMethod: AuthMethod;
  readonly enabled?: boolean;
  readonly weight?: number;
  readonly modelIds: readonly string[];
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

export interface ProviderAdapterHost {
  authorize(): Promise<CredentialMetadata>;
  remove(credentialId: string): Promise<void>;
  refresh?(credentialId: string): Promise<CredentialMetadata>;
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

function adapter(capability: ProviderCapabilityDescriptor, host: ProviderAdapterHost): ProviderAdapter {
  const delegated: ProviderAdapterHost = {
    authorize: async () => validateAdapterCredential(capability, await host.authorize()),
    remove: (credentialId) => host.remove(credentialId),
  };
  if (host.refresh) {
    delegated.refresh = async (credentialId) => validateAdapterCredential(capability, await host.refresh!(credentialId));
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
