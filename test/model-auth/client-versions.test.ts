// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const modulePath = "../../model-auth/packages/providers/src/client-versions.js";
const load = () => import(modulePath);
const npm = (version: unknown) => new Response(JSON.stringify({ name: "@openai/codex", version }));
const traeManifest = (versions: Array<{ region: string; version: string; build: string }>) => new Response(JSON.stringify({ data: { manifest: {
  darwin: { versions: versions.map(({ region, version, build }) => ({ region, arch: "apple", version, url: `https://cdn.example/${region}/stable/${build}/darwin/Trae.dmg` })) },
} } }));

beforeEach(() => { vi.resetModules(); });
afterEach(() => { vi.useRealTimers(); });

describe("latest client versions", () => {
  it("returns a newer published version and never goes below the floor", async () => {
    const { latestClientVersion, CLIENT_VERSION_FLOORS } = await load();
    expect(await latestClientVersion("codex", { fetchImpl: async () => npm("0.160.0") })).toBe("0.160.0");
    expect(await latestClientVersion("grok", { fetchImpl: async () => new Response("1.0.46\n") })).toBe("1.0.46");
    vi.resetModules();
    const fresh = await load();
    expect(await fresh.latestClientVersion("codex", { fetchImpl: async () => npm("0.100.0") })).toBe(CLIENT_VERSION_FLOORS.codex);
    expect(CLIENT_VERSION_FLOORS.codex).toBe("0.158.0");
  });

  it("compares numerically per segment", async () => {
    const { latestClientVersion } = await load();
    expect(await latestClientVersion("codex", { fetchImpl: async () => npm("0.1000.0") })).toBe("0.1000.0");
  });

  it("resolves the floor on lookup failure and does not cache failures", async () => {
    const { latestClientVersion, CLIENT_VERSION_FLOORS } = await load();
    let calls = 0;
    const failing: typeof fetch = async () => { calls++; throw new Error("offline"); };
    expect(await latestClientVersion("codex", { fetchImpl: failing })).toBe(CLIENT_VERSION_FLOORS.codex);
    expect(await latestClientVersion("codex", { fetchImpl: async () => { calls++; return new Response("nope", { status: 503 }); } })).toBe(CLIENT_VERSION_FLOORS.codex);
    expect(await latestClientVersion("codex", { fetchImpl: async () => { calls++; return npm("0.160.0"); } })).toBe("0.160.0");
    expect(calls).toBe(3);
  });

  it("falls back to the grok mirror when the primary source fails", async () => {
    const { latestClientVersion } = await load();
    const urls: string[] = [];
    const version = await latestClientVersion("grok", { fetchImpl: async url => { urls.push(String(url)); return urls.length === 1 ? new Response("blocked", { status: 403 }) : new Response("1.0.46"); } });
    expect(version).toBe("1.0.46");
    expect(urls).toEqual(["https://x.ai/cli/stable", "https://storage.googleapis.com/grok-build-public-artifacts/cli/stable"]);
  });

  it("rejects invalid payloads", async () => {
    const { latestClientVersion, CLIENT_VERSION_FLOORS } = await load();
    const payloads: Array<() => Response> = [
      () => npm("9.9.9-alpha.1"), () => npm(undefined), () => npm("9".repeat(40)), () => npm("latest"), () => new Response("not json"),
      () => new Response(JSON.stringify([npm])), () => new Response("x".repeat(2_100_000)),
    ];
    for (const payload of payloads) expect(await latestClientVersion("codex", { fetchImpl: async () => payload() })).toBe(CLIENT_VERSION_FLOORS.codex);
    expect(await latestClientVersion("grok", { fetchImpl: async () => new Response("<html>challenge</html>") })).toBe(CLIENT_VERSION_FLOORS.grok);
  });

  it("caches successful lookups until the TTL expires", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const { latestClientVersion } = await load();
    let calls = 0, version = "0.160.0";
    const fetchImpl: typeof fetch = async () => { calls++; return npm(version); };
    expect(await latestClientVersion("codex", { fetchImpl })).toBe("0.160.0");
    version = "0.170.0";
    expect(await latestClientVersion("codex", { fetchImpl })).toBe("0.160.0");
    expect(calls).toBe(1);
    vi.setSystemTime(Date.now() + 6 * 60 * 60 * 1000 + 1);
    expect(await latestClientVersion("codex", { fetchImpl })).toBe("0.170.0");
    expect(calls).toBe(2);
  });

  it("shares one in-flight request between concurrent callers", async () => {
    const { latestClientVersion } = await load();
    let calls = 0, release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const fetchImpl: typeof fetch = async () => { calls++; await gate; return npm("0.160.0"); };
    const results = [latestClientVersion("codex", { fetchImpl }), latestClientVersion("codex", { fetchImpl }), latestClientVersion("codex", { fetchImpl })];
    release();
    expect(await Promise.all(results)).toEqual(["0.160.0", "0.160.0", "0.160.0"]);
    expect(calls).toBe(1);
  });

  it("returns the floor for a caller whose signal aborts without failing other waiters", async () => {
    const { latestClientVersion, CLIENT_VERSION_FLOORS } = await load();
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const fetchImpl: typeof fetch = async () => { await gate; return npm("0.160.0"); };
    const controller = new AbortController();
    const cancelled = latestClientVersion("codex", { fetchImpl, signal: controller.signal });
    const other = latestClientVersion("codex", { fetchImpl });
    controller.abort();
    expect(await cancelled).toBe(CLIENT_VERSION_FLOORS.codex);
    release();
    expect(await other).toBe("0.160.0");
  });

  it("reads Trae app and build versions from the international regions only", async () => {
    const { latestClientVersion } = await load();
    let calls = 0;
    const fetchImpl: typeof fetch = async () => { calls++; return traeManifest([
      { region: "cn", version: "9.9.9", build: "9.9.99999" },
      { region: "sg", version: "3.5.104", build: "2.3.88407" },
      { region: "va", version: "3.5.104", build: "2.3.88407" },
    ]); };
    expect(await latestClientVersion("trae-app", { fetchImpl })).toBe("3.5.104");
    expect(await latestClientVersion("trae-build", { fetchImpl })).toBe("2.3.88407");
    expect(calls).toBe(1);
  });
});
