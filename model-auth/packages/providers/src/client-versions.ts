export type ClientVersionTarget = "claude" | "codex" | "grok" | "trae-app" | "trae-build";
export interface ClientVersionOptions { readonly fetchImpl?: typeof fetch; readonly signal?: AbortSignal; readonly timeoutMs?: number; }

/** Oldest versions known to be accepted; lookups never resolve below these. */
export const CLIENT_VERSION_FLOORS: Readonly<Record<ClientVersionTarget, string>> = Object.freeze({ claude: "2.1.290", codex: "0.160.0", grok: "1.0.46", "trae-app": "3.5.104", "trae-build": "2.3.88407" });

type Feed = "claude" | "codex" | "grok" | "trae";
type Versions = Partial<Record<ClientVersionTarget, string>>;
const FEEDS: Readonly<Record<Feed, { urls: readonly string[]; parse: (body: string) => Versions }>> = {
  claude: { urls: ["https://registry.npmjs.org/@anthropic-ai/claude-code/latest"], parse: body => single("claude", version(record(json(body))?.version)) },
  codex: { urls: ["https://registry.npmjs.org/@openai/codex/latest"], parse: body => single("codex", version(record(json(body))?.version)) },
  grok: { urls: ["https://x.ai/cli/stable", "https://storage.googleapis.com/grok-build-public-artifacts/cli/stable"], parse: body => single("grok", version(body.split(/\r?\n/, 1)[0])) },
  trae: { urls: ["https://api.trae.ai/icube/api/v1/native/version/trae/latest"], parse: parseTrae },
};
const FEED_OF: Readonly<Record<ClientVersionTarget, Feed>> = { claude: "claude", codex: "codex", grok: "grok", "trae-app": "trae", "trae-build": "trae" };
const LEAD_OF: Readonly<Record<Feed, ClientVersionTarget>> = { claude: "claude", codex: "codex", grok: "grok", trae: "trae-app" };
const TTL_MS = 6 * 60 * 60 * 1000, RETRY_MS = 5 * 60 * 1000, DEFAULT_TIMEOUT_MS = 5_000, MAX_BODY_CHARS = 2_000_000;
const cache = new Map<Feed, { at: number; ttl: number; versions?: Versions }>();
const inflight = new Map<Feed, Promise<Versions | undefined>>();

/** Resolve the newest official client version, never lower than its floor; a failed lookup yields the last known version or the floor. */
export async function latestClientVersion(client: ClientVersionTarget, options: ClientVersionOptions = {}): Promise<string> {
  if (!Object.hasOwn(CLIENT_VERSION_FLOORS, client)) throw new Error(`Unknown client version target: ${String(client)}.`);
  const floor = CLIENT_VERSION_FLOORS[client], feed = FEED_OF[client];
  const hit = cache.get(feed);
  let versions = hit?.versions;
  if (!hit || Date.now() - hit.at >= hit.ttl) {
    let pending = inflight.get(feed);
    if (!pending) {
      pending = fetchFeed(feed, options).finally(() => inflight.delete(feed));
      inflight.set(feed, pending);
    }
    versions = (await until(pending, options.signal)) ?? versions;
  }
  // Versions from one feed are taken or rejected together so paired values (Trae app and build) never mix with floors.
  const lead = LEAD_OF[feed], latest = versions?.[client], leading = versions?.[lead];
  return latest && leading && compareVersions(leading, CLIENT_VERSION_FLOORS[lead]) > 0 ? latest : floor;
}

async function fetchFeed(feed: Feed, options: ClientVersionOptions): Promise<Versions | undefined> {
  const { urls, parse } = FEEDS[feed], fetchImpl = options.fetchImpl ?? fetch;
  const timeout = Number.isFinite(options.timeoutMs) && options.timeoutMs! > 0 ? options.timeoutMs! : DEFAULT_TIMEOUT_MS;
  for (const url of urls) {
    try {
      // The shared request ignores any single caller's signal so one cancellation cannot fail the other waiters.
      const response = await fetchImpl(url, { headers: { accept: "application/json, text/plain" }, redirect: "error", signal: AbortSignal.timeout(timeout) });
      if (!response.ok) continue;
      const body = await response.text();
      if (body.length > MAX_BODY_CHARS) continue;
      const versions = parse(body);
      if (Object.keys(versions).length) { cache.set(feed, { at: Date.now(), ttl: TTL_MS, versions }); return versions; }
    } catch { /* try the next mirror */ }
  }
  // Back off after a failure so unreachable sources do not add a timeout to every request.
  const stale = cache.get(feed)?.versions;
  cache.set(feed, { at: Date.now(), ttl: RETRY_MS, ...(stale ? { versions: stale } : {}) });
  return stale;
}

function single(client: ClientVersionTarget, value: string | undefined): Versions { return value ? { [client]: value } : {}; }

function parseTrae(body: string): Versions {
  const manifest = record(record(record(json(body))?.data)?.manifest);
  let app: string | undefined, build: string | undefined;
  for (const platform of Object.values(manifest ?? {})) {
    const entries = record(platform)?.versions;
    if (!Array.isArray(entries)) continue;
    for (const entry of entries) {
      const item = record(entry);
      if (item?.region !== "va" && item?.region !== "sg") continue;
      const appVersion = version(item.version), buildVersion = version(/\/stable\/(\d+\.\d+\.\d+)\//.exec(typeof item.url === "string" ? item.url : "")?.[1]);
      if (!appVersion || !buildVersion) continue;
      // Keep the pair from one release entry so the app and build versions always match.
      const order = app && build ? compareVersions(appVersion, app) || compareVersions(buildVersion, build) : 1;
      if (order > 0) { app = appVersion; build = buildVersion; }
    }
  }
  return { ...(app ? { "trae-app": app } : {}), ...(build ? { "trae-build": build } : {}) };
}

function until(pending: Promise<Versions | undefined>, signal?: AbortSignal): Promise<Versions | undefined> {
  if (!signal) return pending;
  if (signal.aborted) return Promise.resolve(undefined);
  return new Promise(resolve => {
    const done = (value?: Versions) => { signal.removeEventListener("abort", onAbort); resolve(value); };
    const onAbort = () => done();
    signal.addEventListener("abort", onAbort, { once: true });
    pending.then(done, () => done());
  });
}

function compareVersions(a: string, b: string): number {
  const left = a.split(".").map(Number), right = b.split(".").map(Number);
  for (let index = 0; index < Math.max(left.length, right.length); index++) {
    const delta = (left[index] ?? 0) - (right[index] ?? 0);
    if (delta) return delta;
  }
  return 0;
}

function version(value: unknown): string | undefined {
  const text = typeof value === "string" ? value.trim() : "";
  return text.length <= 32 && /^\d{1,9}(?:\.\d{1,9}){1,3}$/.test(text) ? text : undefined;
}
function record(value: unknown): Record<string, unknown> | undefined { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined; }
function json(value: string): unknown { try { return JSON.parse(value); } catch { return undefined; } }
