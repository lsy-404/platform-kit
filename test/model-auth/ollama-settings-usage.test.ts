import { describe, expect, it } from "vitest";
import { authorizeOllamaWeb, parseOllamaSettings, queryOllamaUsage } from "../../model-auth/packages/providers/src/ollama.js";

// Fixtures are the ollama.com/settings markup used by the token-monitor reference tests.
const SETTINGS_HTML = `
<span>Cloud Usage</span><span>Pro</span>
<span id="header-email">USER@example.com</span>
<section aria-label="Session usage 14.5% used">
  <div style="width: 14.5%"></div>
  <div data-time="2026-07-09T08:00:00Z">Resets soon</div>
</section>
<section><span>Weekly usage</span><span>10.3% used</span>
  <div data-time="2026-07-13T00:00:00Z"></div>
</section>`;

const FORMATTED_HTML = `
    <h2><span>Cloud usage</span><span class="badge">free</span
    ></h2>
    <h2 id="header-email">user@example.com</h2>
    <div>
      <span>Session usage</span><span>0% used</span>
      <div aria-label="Session usage 0% used"></div>
      <div class="local-time" data-time="2026-07-12T06:00:00Z">Resets in 2 hours.</div>
    </div>
    <div>
      <span>Weekly usage</span><span>0% used</span>
      <div aria-label="Weekly usage 0% used"></div>
      <div class="local-time" data-time="2026-07-13T00:00:00Z">Resets in 20 hours.</div>
    </div>
  `;

const REVERSED_HTML = `
    <section>Weekly usage<div style="width: 80%"></div></section>
    <section>Hourly usage<span>25% used</span></section>
  `;

const SIGNED_OUT_HTML = '<form action="/signin"><input type="email"></form>';

function page(status: number, init: { location?: string; html?: string } = {}): Response {
  return new Response(init.html ?? null, { status, ...(init.location ? { headers: { location: init.location } } : {}) });
}

describe("Ollama settings page parsing", () => {
  it("reads plan, identity, percentages, resets and window lengths", () => {
    const parsed = parseOllamaSettings(SETTINGS_HTML);
    expect(parsed).toMatchObject({ plan: "Pro", identity: "user@example.com", status: "ok", balance: null });
    expect(parsed.windows).toMatchObject([
      { id: "session", kind: "session", usedPercent: 14.5, resetAt: Date.parse("2026-07-09T08:00:00Z"), windowSeconds: 300 * 60, reliability: "high" },
      { id: "weekly", kind: "weekly", usedPercent: 10.3, resetAt: Date.parse("2026-07-13T00:00:00Z"), windowSeconds: 10080 * 60, reliability: "high" },
    ]);
  });

  it("uses the first occurrence of each window, not a later repeat", () => {
    const html = FORMATTED_HTML
      .replace('aria-label="Session usage 0% used"', 'aria-label="Session usage 99% used"')
      .replace('aria-label="Weekly usage 0% used"', 'aria-label="Weekly usage 88% used"');
    expect(parseOllamaSettings(html).windows).toMatchObject([
      { kind: "session", usedPercent: 0, resetAt: Date.parse("2026-07-12T06:00:00Z") },
      { kind: "weekly", usedPercent: 0, resetAt: Date.parse("2026-07-13T00:00:00Z") },
    ]);
  });

  it("reports one short window when the page shows both Session and Hourly", () => {
    const html = `${REVERSED_HTML}<div>Session usage</div><span>40% used</span><div data-time="2026-07-12T06:00:00Z"></div>`;
    const parsed = parseOllamaSettings(html);
    expect(parsed.windows.map(window => [window.id, window.usedPercent])).toEqual([["hourly", 25], ["weekly", 80]]);
  });

  it("takes the plan verbatim and ignores repeated aria labels", () => {
    const parsed = parseOllamaSettings(FORMATTED_HTML);
    expect(parsed.plan).toBe("free");
    expect(parsed.windows).toMatchObject([
      { kind: "session", usedPercent: 0, resetAt: Date.parse("2026-07-12T06:00:00Z") },
      { kind: "weekly", usedPercent: 0, resetAt: Date.parse("2026-07-13T00:00:00Z") },
    ]);
  });

  it("accepts any plan name, not only free, pro or max", () => {
    expect(parseOllamaSettings("<span>Cloud Usage</span><span>Team Plus</span>").plan).toBe("Team Plus");
  });

  it("orders session before weekly and falls back to the CSS width and the hourly length", () => {
    const parsed = parseOllamaSettings(REVERSED_HTML);
    expect(parsed.windows.map(window => [window.kind, window.usedPercent])).toEqual([["session", 25], ["weekly", 80]]);
    expect(parsed.windows[0]).toMatchObject({ windowSeconds: 60 * 60 });
  });

  it("marks a fully used window exhausted and omits identity without an email", () => {
    const parsed = parseOllamaSettings("<div>Weekly usage</div><span>100% used</span><span id=\"header-email\">not-an-email</span>");
    expect(parsed.windows[0]).toMatchObject({ kind: "weekly", usedPercent: 100, status: "exhausted" });
    expect(parsed).not.toHaveProperty("identity");
  });

  it("clamps a percentage above 100", () => {
    expect(parseOllamaSettings('<div>Weekly usage</div><div style="width: 130%"></div>').windows[0]).toMatchObject({ usedPercent: 100, remainingPercent: 0 });
  });

  it("reports unknown when no usage meters are present", () => {
    expect(parseOllamaSettings("<h2>Cloud Usage</h2><p>Plan: Pro</p>")).toMatchObject({ status: "unknown", windows: [] });
  });
});

describe("Ollama settings page request", () => {
  it("sends the cookie with browser-style accept headers and refuses automatic redirects", async () => {
    const seen: Array<{ url: string; headers: Headers; redirect: RequestRedirect | undefined }> = [];
    const snapshot = await queryOllamaUsage({ cookie: "wos-session=current; aid=1", fetchImpl: async (url, init) => {
      seen.push({ url: String(url), headers: new Headers(init?.headers), redirect: init?.redirect });
      return page(200, { html: SETTINGS_HTML });
    } });
    expect(snapshot).toMatchObject({ providerId: "ollama-cloud", status: "ok", plan: "Pro", identity: "user@example.com" });
    expect(seen).toHaveLength(1);
    expect(seen[0]!.url).toBe("https://ollama.com/settings");
    expect(seen[0]!.headers.get("cookie")).toBe("wos-session=current; aid=1");
    expect(seen[0]!.headers.get("accept")).toBe("text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8");
    expect(seen[0]!.headers.get("accept-language")).toBe("en-US,en;q=0.9");
    expect(seen[0]!.headers.get("user-agent")).toBe("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36");
    expect(seen[0]!.redirect).toBe("manual");
  });

  it("gives up after four redirects", async () => {
    let calls = 0;
    const snapshot = await queryOllamaUsage({ cookie: "wos-session=current", fetchImpl: async () => { calls += 1; return page(307, { location: "/settings" }); } });
    expect(calls).toBe(5);
    expect(snapshot).toMatchObject({ status: "error", errorCode: "server-error" });
  });

  it("does not read an opaque redirect response as a signed-out session", async () => {
    const opaque = { status: 0, type: "opaqueredirect", url: "", headers: new Headers(), text: async () => "" } as unknown as Response;
    const snapshot = await queryOllamaUsage({ cookie: "wos-session=current", fetchImpl: async () => opaque });
    expect(snapshot).toMatchObject({ status: "error", errorCode: "server-error" });
  });

  it("reports a signed-in page without meters as unknown rather than an error", async () => {
    const html = '<span>Cloud Usage</span><span>Pro</span><span id="header-email">user@example.com</span>';
    const snapshot = await queryOllamaUsage({ cookie: "wos-session=current", fetchImpl: async () => page(200, { html }) });
    expect(snapshot).toMatchObject({ status: "unknown", errorCode: "no-limits", plan: "Pro", identity: "user@example.com", windows: [] });
  });

  it("follows same-origin redirects and keeps the cookie on ollama.com only", async () => {
    const seen: Array<{ url: string; cookie: string | null }> = [];
    const snapshot = await queryOllamaUsage({ cookie: "wos-session=current", fetchImpl: async (url, init) => {
      seen.push({ url: String(url), cookie: new Headers(init?.headers).get("cookie") });
      return seen.length === 1 ? page(307, { location: "/settings/" }) : page(200, { html: SETTINGS_HTML });
    } });
    expect(snapshot.status).toBe("ok");
    expect(seen).toEqual([
      { url: "https://ollama.com/settings", cookie: "wos-session=current" },
      { url: "https://ollama.com/settings/", cookie: "wos-session=current" },
    ]);
  });

  it.each([
    "https://signin.ollama.com/start",
    "/signin",
    "https://api.workos.com/user_management/authorize?client_id=x",
  ])("treats a redirect to %s as a signed-out session", async location => {
    const snapshot = await queryOllamaUsage({ cookie: "wos-session=expired", fetchImpl: async () => page(302, { location }) });
    expect(snapshot).toMatchObject({ status: "error", errorCode: "signed-out", error: "Ollama web session has expired." });
  });

  it("does not treat an unrelated redirect as signed out", async () => {
    const seen: string[] = [];
    const snapshot = await queryOllamaUsage({ cookie: "wos-session=current", fetchImpl: async url => { seen.push(String(url)); return page(302, { location: "https://example.com/" }); } });
    expect(snapshot).toMatchObject({ status: "error", errorCode: "server-error" });
    expect(seen).toEqual(["https://ollama.com/settings"]);
  });

  it("classifies a signed-out 200 page, rejection, throttling, outages and network failure", async () => {
    const run = (fetchImpl: typeof fetch) => queryOllamaUsage({ cookie: "wos-session=value", fetchImpl });
    expect(await run(async () => page(200, { html: SIGNED_OUT_HTML }))).toMatchObject({ status: "error", errorCode: "signed-out" });
    expect(await run(async () => page(401))).toMatchObject({ status: "error", errorCode: "signed-out" });
    expect(await run(async () => page(403))).toMatchObject({ status: "error", errorCode: "signed-out" });
    expect(await run(async () => page(429))).toMatchObject({ status: "error", errorCode: "rate-limited" });
    expect(await run(async () => page(500))).toMatchObject({ status: "error", errorCode: "server-error" });
    expect(await run(async () => { throw new TypeError("network down"); })).toMatchObject({ status: "error", errorCode: "unreachable" });
  });

  it("reports a 200 page without meters that is not a sign-in page as unreadable", async () => {
    const snapshot = await queryOllamaUsage({ cookie: "wos-session=value", fetchImpl: async () => page(200, { html: "<h1>Settings</h1>" }) });
    expect(snapshot).toMatchObject({ status: "error", errorCode: "unreadable", windows: [] });
  });

  it("never echoes the cookie", async () => {
    const snapshot = await queryOllamaUsage({ cookie: "wos-session=secret-cookie-value", fetchImpl: async () => page(200, { html: SETTINGS_HTML }) });
    expect(JSON.stringify(snapshot)).not.toContain("secret-cookie-value");
  });
});

describe("Ollama browser authorization", () => {
  it("accepts a signed-in settings page that has no meters, after skipping a signed-out poll", async () => {
    const pages = [SIGNED_OUT_HTML, '<span>Cloud Usage</span><span>Free</span><span id="header-email">user@example.com</span>'];
    let fetches = 0;
    const result = await authorizeOllamaWeb({
      openExternal: async () => undefined,
      readCookieHeader: async () => "wos-session=opaque",
      pollMs: 250,
      timeoutMs: 5_000,
      fetchImpl: async () => page(200, { html: pages[Math.min(fetches++, pages.length - 1)]! }),
    });
    expect(fetches).toBe(2);
    expect(result.session.cookie).toBe("wos-session=opaque");
    expect(result.usage).toMatchObject({ status: "unknown", errorCode: "no-limits", identity: "user@example.com" });
  });
});
