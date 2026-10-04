export type ClientVersionTarget = "codex" | "grok" | "trae-app" | "trae-build";
export interface ClientVersionOptions { readonly fetchImpl?: typeof fetch; readonly signal?: AbortSignal; readonly timeoutMs?: number; }

/** Oldest versions known to be accepted; lookups never resolve below these. */
export const CLIENT_VERSION_FLOORS: Readonly<Record<ClientVersionTarget, string>> = Object.freeze({ codex: "0.158.0", grok: "0.2.99", "trae-app": "3.5.81", "trae-build": "2.3.61406" });

type Feed = "codex" | "grok" | "trae";
type Versions = Partial<Record<ClientVersionTarget, string>>;
const FEEDS: Readonly<Record<Feed, { urls: readonly string[]; parse: (body: string) => Versions }>> = {
  codex: { urls: ["https://registry.npmjs.org/@openai/codex/latest"], parse: body => single("codex", version(record(json(body))?.version)) },
  grok: { urls: ["https://x.ai/cli/stable", "https://storage.googleapis.com/grok-build-public-artifacts/cli/stable"], parse: body => single("grok", version(body.split(/\r?\n/, 1)[0])) },
  trae: { urls: ["https://api.trae.ai/icube/api/v1/native/version/trae/latest"], parse: parseTrae },
};
const FEED_OF: Readonly<Record<ClientVersionTarget, Feed>> = { codex: "codex", grok: "grok", "trae-app": "trae", "trae-build": "trae" };
const TTL_MS = 6 * 60 * 60 * 1000, DEFAULT_TIMEOUT_MS = 5_000, MAX_BODY_CHARS = 2_000_000;
const cache = new Map<Feed, { at: number; versions: Versions }>();
const inflight = new Map<Feed, Promise<Versions | undefined>>();

/** Resolve the newest official client version, never lower than its floor; any lookup failure yields the floor. */
export async function latestClientVersion(client: ClientVersionTarget, options: ClientVersionOptions = {}): Promise<string> {
  const floor = CLIENT_VERSION_FLOORS[client], feed = FEED_OF[client];
  if (!floor) throw new Error(`Unknown client version target: ${String(client)}.`);
  const hit = cache.get(feed);
  let versions = hit && Date.now() - hit.at < TTL_MS ? hit.versions : undefined;
  if (!versions) {
    let pending = inflight.get(feed);
    if (!pending) {
      pending = fetchFeed(feed, options).finally(() => inflight.delete(feed));
      inflight.set(feed, pending);
    }
    versions = await until(pending, options.signal);
  }
  const latest = versions?.[client];
  return latest && compareVersions(latest, floor) > 0 ? latest : floor;
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
      if (Object.keys(versions).length) { cache.set(feed, { at: Date.now(), versions }); return versions; }
    } catch { /* try the next mirror */ }
  }
  return undefined;
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
      if (appVersion && (!app || compareVersions(appVersion, app) > 0)) app = appVersion;
      if (buildVersion && (!build || compareVersions(buildVersion, build) > 0)) build = buildVersion;
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
