import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { createContext, runInContext } from "node:vm";
import { createRequire } from "node:module";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../model-auth");
const output = mkdtempSync(join(tmpdir(), "platform-kit-model-auth-packages-"));
const require = createRequire(join(root, "package.json"));
const { Window } = require("happy-dom");
const run = mkdtempSync(join(output, "consumer-"));
const archives = join(run, "archives");
mkdirSync(archives);
for (const name of ["core", "vue", "providers"]) {
  execFileSync("corepack", ["pnpm@10.17.1", "--dir", join(root, "packages", name), "pack", "--pack-destination", archives], { stdio: "pipe" });
}
const files = ["core", "vue", "providers"].map(name => {
  const version = JSON.parse(readFileSync(join(root, "packages", name, "package.json"), "utf8")).version;
  return join(archives, "model-auth-" + name + "-" + version + ".tgz");
});
for (const archive of files) assert.ok(existsSync(archive));
const consumer = join(run, "app");
mkdirSync(consumer);
writeFileSync(join(consumer, "package.json"), JSON.stringify({ private: true, type: "module" }));
execFileSync("corepack", ["pnpm@10.17.1", "add", "--dir", consumer, "--ignore-scripts", ...files, "vue@3.5.42"], { stdio: "pipe" });

for (const name of ["core", "vue", "providers"]) {
  const folder = join(consumer, "node_modules", "@model-auth", name);
  const manifest = JSON.parse(readFileSync(join(folder, "package.json"), "utf8"));
  assert.equal(manifest.license, "Apache-2.0");
  assert.ok(readFileSync(join(folder, "LICENSE"), "utf8").includes("Apache License"));
  assert.ok(!JSON.stringify(manifest.dependencies ?? {}).includes("workspace:"));
  for (const entry of Object.values(manifest.exports)) {
    for (const file of typeof entry === "string" ? [entry] : Object.values(entry)) assert.ok(existsSync(join(folder, file)), name + " missing export " + file);
  }
}
assert.ok(readFileSync(join(consumer, "node_modules/@model-auth/providers/THIRD-PARTY.md"), "utf8").includes("Salesforce.com"));
assert.ok(readFileSync(join(consumer, "node_modules/@model-auth/vue/THIRD-PARTY.md"), "utf8").includes("Yuxi (Evan) You"));
assert.ok(readFileSync(join(consumer, "node_modules/@model-auth/vue/THIRD-PARTY.md"), "utf8").includes("LobeHub"));
const vueBundle = readFileSync(join(consumer, "node_modules/@model-auth/vue/dist/model-auth-vue.js"), "utf8");
assert.ok(vueBundle.includes("<svg") && !vueBundle.includes("favicon") && !/from\s+["']@lobehub/.test(vueBundle), "Provider icons must be bundled, not fetched or imported");
assert.ok(!/from\s+["']@fluentui/.test(vueBundle) && vueBundle.includes("M3.15"), "Control icons must be bundled, not imported");
assert.ok(readFileSync(join(consumer, "node_modules/@model-auth/vue/THIRD-PARTY.md"), "utf8").includes("Microsoft Corporation"));
assert.ok(!Object.keys(JSON.parse(readFileSync(join(consumer, "node_modules/@model-auth/vue/package.json"), "utf8")).dependencies ?? {}).some(name => name.startsWith("@fluentui")));
assert.ok(vueBundle.includes('import "./model-auth.css"'), "Vue entry must load the default stylesheet");
const standalone = readFileSync(join(consumer, "node_modules/@model-auth/vue/dist/model-auth-element.js"), "utf8");
assert.ok(!/from\s+["']vue["']/.test(standalone), "Standalone build must bundle Vue");
assert.ok(standalone.includes(".model-auth-styled"), "Standalone build must embed theme styles");
const browser = createContext(new Window({ url: "https://model-auth.test/" }));
assert.equal(runInContext("typeof process", browser), "undefined");
const browserScript = standalone.replace(/export\s*\{([^}]+)\};?\s*$/, (_, declarations) => declarations.split(",").map(entry => {
  const [local, exported] = entry.trim().split(/\s+as\s+/);
  return `globalThis.${exported || local} = ${local};`;
}).join("\n"));
runInContext(browserScript, browser, { timeout: 5000 });
browser.registerModelAuthElement();
const element = browser.document.createElement("model-auth-dialog");
browser.document.body.append(element);
element.providers = [{ id: "sample", name: "Sample", description: "", authMethods: ["oauth", "api-key"], available: true, models: [], oauthCredentials: [], apiKeyCredentials: [] }];
element.open = true;
await browser.happyDOM.waitUntilComplete();
assert.ok(element.shadowRoot.textContent.includes("Sample (OAuth)"), "Raw standalone asset must start without Node globals or a Vite transform");
assert.ok(element.shadowRoot.textContent.includes("Sample (Key)"));
assert.equal(element.shadowRoot.querySelector("dialog")?.open, true, "Packed custom element must open a native modal");
assert.equal(element.shadowRoot.querySelectorAll(".model-auth-progress-segment").length, 2);
element.open = false;
await browser.happyDOM.waitUntilComplete();
element.separateAuthMethods = true;
element.open = true;
await browser.happyDOM.waitUntilComplete();
assert.ok(element.shadowRoot.querySelector('[data-part="method-list"]'), "Packed custom element must accept the separated-authentication property");
assert.equal(element.shadowRoot.querySelectorAll(".model-auth-progress-segment").length, 3);
element.shadowRoot.querySelector('[data-part="method-api-key"]').click();
await browser.happyDOM.waitUntilComplete();
assert.equal(element.shadowRoot.querySelectorAll('[data-auth-method="oauth"]').length, 0);
assert.ok(element.shadowRoot.querySelector('[data-auth-method="api-key"]'));
element.remove();
await browser.happyDOM.close();
writeFileSync(join(consumer, "entry.ts"), `
import { ModelAuthDialog, type ModelAuthProvider, type CredentialUsage, type ProviderCredential } from "@model-auth/vue";
import { registerModelAuthElement } from "@model-auth/vue/custom-element";
import { CredentialRouter, createCredentialMetadata, createUsageGate, parseRetryAfter, type UsageGate } from "@model-auth/core";
import { authorizeWorkBuddy, refreshWorkBuddy } from "@model-auth/providers/workbuddy";
import { authorizeOpenAI, refreshOpenAI, listOpenAICodexModels, parseOpenAICodexModels, type OpenAICodexModel } from "@model-auth/providers/openai";
import { latestClientVersion, CLIENT_VERSION_FLOORS, type ClientVersionTarget } from "@model-auth/providers/client-versions";
import { authorizeAnthropic, refreshAnthropic } from "@model-auth/providers/anthropic";
import { authorizeTrae, refreshTrae, listTraeModels, streamTrae } from "@model-auth/providers/trae";
import { authorizeGrok, queryGrokUsage } from "@model-auth/providers/grok";
import { authorizeOllamaWeb, queryOllamaUsage, parseOllamaSettings } from "@model-auth/providers/ollama";
import { queryOpencodeGoKeyUsage, parseOpencodeGoUsage } from "@model-auth/providers/opencode";
import { queryProviderUsage, queryClaudePrepaidCredits, parseAnthropicUsage } from "@model-auth/providers/usage";
import type { ProviderUsageExtraUsage } from "@model-auth/core";
const extraUsage: ProviderUsageExtraUsage | null | undefined = parseAnthropicUsage({}).extraUsage;
const gate: UsageGate = createUsageGate({ minIntervalMs: () => 0 });
const retryAfter: number | null = parseRetryAfter("120");
const usage = { providerId: "anthropic", credentialId: "one", status: "ok", plan: null, windows: [], balance: { amount: 1, unit: "USD", funded: true }, basis: "estimated", observedAtUtc: "2030-01-01T00:00:00Z", fetchedAtUtc: "2030-01-01T00:00:00Z", error: null } satisfies CredentialUsage;
const credential = { id: "one", label: "One", healthy: true, enabled: true, usage, cooldown: { until: 1, reason: "rate-limited" } } satisfies ProviderCredential;
const providers: ModelAuthProvider[] = [];
const dialogProps: InstanceType<typeof ModelAuthDialog>["$props"] = { separateAuthMethods: false };
void dialogProps;
const target: ClientVersionTarget = "codex";
const pending: Promise<string> = latestClientVersion(target);
const models: readonly OpenAICodexModel[] = parseOpenAICodexModels({ models: [] });
const router = new CredentialRouter([createCredentialMetadata({ id: "one", providerId: "sample", authMethod: "api-key", modelIds: ["sample"] })]);
void [gate, retryAfter, credential, providers, router, ModelAuthDialog, registerModelAuthElement, authorizeWorkBuddy, refreshWorkBuddy, authorizeTrae, refreshTrae, listTraeModels, streamTrae, authorizeOpenAI, refreshOpenAI, authorizeAnthropic, refreshAnthropic, authorizeGrok, queryGrokUsage, authorizeOllamaWeb, queryOllamaUsage, parseOllamaSettings, queryOpencodeGoKeyUsage, parseOpencodeGoUsage, queryProviderUsage, queryClaudePrepaidCredits, extraUsage, listOpenAICodexModels, CLIENT_VERSION_FLOORS, pending, models];
`);
execFileSync(process.execPath, [join(root, "node_modules/typescript/bin/tsc"), "--noEmit", "--strict", "--skipLibCheck", "--moduleResolution", "bundler", "--module", "esnext", "--target", "es2023", join(consumer, "entry.ts")], { stdio: "pipe", cwd: consumer });
execFileSync(process.execPath, [join(root, "node_modules/typescript/bin/tsc"), "--noEmit", "--strict", "--skipLibCheck", "--moduleResolution", "node", "--module", "commonjs", "--target", "es2023", join(consumer, "entry.ts")], { stdio: "pipe", cwd: consumer });
execFileSync(process.execPath, ["--input-type=module", "-e", `
import { CredentialRouter, createCredentialMetadata, createUsageGate, parseRetryAfter } from "@model-auth/core";
import { authorizeWorkBuddy, refreshWorkBuddy } from "@model-auth/providers/workbuddy";
import { authorizeOpenAI, refreshOpenAI, listOpenAICodexModels, parseOpenAICodexModels } from "@model-auth/providers/openai";
import { latestClientVersion, CLIENT_VERSION_FLOORS } from "@model-auth/providers/client-versions";
import { latestClientVersion as rootLatestClientVersion } from "@model-auth/providers";
import { authorizeAnthropic, refreshAnthropic } from "@model-auth/providers/anthropic";
import { authorizeGrok, queryGrokUsage } from "@model-auth/providers/grok";
import { authorizeOllamaWeb, queryOllamaUsage, parseOllamaSettings } from "@model-auth/providers/ollama";
import { queryOpencodeGoKeyUsage, parseOpencodeGoUsage } from "@model-auth/providers/opencode";
import { queryClaudePrepaidCredits, parseAnthropicUsage } from "@model-auth/providers/usage";
const ollama = parseOllamaSettings("<span>Cloud Usage</span><span>Pro</span><div>Weekly usage</div><span>25% used</span>");
if (ollama.plan !== "Pro" || ollama.windows[0]?.remainingPercent !== 75) throw new Error("Installed Ollama settings parser unavailable");
const opencode = await queryOpencodeGoKeyUsage("consumer-key", { fetchImpl: async () => Response.json({ usage: { rolling: { percent: 10 }, weekly: { percent: 25 } } }) });
if (opencode.plan !== "Go" || opencode.windows[1]?.remainingPercent !== 75) throw new Error("Installed OpenCode Go usage unavailable");
const extra = parseAnthropicUsage({ spend: { enabled: true, used: { amount_minor: 235, currency: "USD", exponent: 2 }, limit: { amount_minor: 2000, currency: "USD", exponent: 2 } } }).extraUsage;
if (extra?.used !== 2.35 || extra.limit !== 20 || extra.usedPercent !== 11.75) throw new Error("Installed Claude extra usage unavailable");
const prepaid = await queryClaudePrepaidCredits({ fetchImpl: async url => Response.json(String(url).endsWith("/api/organizations") ? [{ uuid: "org-1" }] : { amount: 1234, currency: "USD" }) });
if (prepaid.balance?.amount !== 12.34) throw new Error("Installed Claude prepaid credits unavailable");
if (typeof authorizeWorkBuddy !== "function" || typeof refreshWorkBuddy !== "function") throw new Error("Installed providers unavailable");
for (const provider of [authorizeOpenAI, refreshOpenAI, authorizeAnthropic, refreshAnthropic, authorizeGrok, queryGrokUsage, authorizeOllamaWeb, queryOllamaUsage, parseOllamaSettings, queryOpencodeGoKeyUsage, parseOpencodeGoUsage]) {
  if (typeof provider !== "function") throw new Error("Installed browser OAuth unavailable");
}
if (latestClientVersion !== rootLatestClientVersion || typeof listOpenAICodexModels !== "function") throw new Error("Installed client version lookup unavailable");
if (parseOpenAICodexModels({ models: [{ slug: "sample" }] })[0]?.id !== "sample") throw new Error("Installed Codex catalog parser unavailable");
if (await latestClientVersion("grok", { fetchImpl: async () => { throw new Error("offline"); } }) !== CLIENT_VERSION_FLOORS.grok) throw new Error("Installed client version floor unavailable");
if (parseRetryAfter("120") !== 120000 || parseRetryAfter("soon") !== null) throw new Error("Installed Retry-After parser unavailable");
const gated = await createUsageGate({ minIntervalMs: () => 0 }).run("one", { providerId: "sample", reason: "manual" }, async () => "read");
if (!gated.ran || gated.value !== "read") throw new Error("Installed usage gate unavailable");
const router = new CredentialRouter([createCredentialMetadata({ id: "one", providerId: "sample", authMethod: "api-key", modelIds: ["sample"] })]);
if (router.candidates({ providerId: "sample", modelId: "sample" })[0]?.id !== "one") throw new Error("Installed core cannot route");
`], { stdio: "pipe", cwd: consumer });
console.log("Package consumer passed: installed tarballs, declarations, runtime, styles, standalone and licenses.");

rmSync(output, { recursive: true, force: true });
