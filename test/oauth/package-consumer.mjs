import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createContext, runInContext } from "node:vm";
import { createRequire } from "node:module";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../oauth");
const output = resolve(dirname(fileURLToPath(import.meta.url)), ".output");
const require = createRequire(join(root, "package.json"));
const { Window } = require("happy-dom");
mkdirSync(output, { recursive: true });
const run = mkdtempSync(join(output, "consumer-"));
const archives = join(run, "archives");
mkdirSync(archives);
const pnpm = process.env.npm_execpath;
assert.ok(pnpm, "Run through pnpm test:packages");
for (const name of ["core", "vue", "providers"]) {
  execFileSync(process.execPath, [pnpm, "--dir", join(root, "packages", name), "pack", "--pack-destination", archives], { stdio: "pipe" });
}
const version = JSON.parse(readFileSync(join(root, "package.json"), "utf8")).version;
const files = ["core", "vue", "providers"].map(name => join(archives, "model-auth-" + name + "-" + version + ".tgz"));
for (const archive of files) assert.ok(existsSync(archive));
const consumer = join(run, "app");
mkdirSync(consumer);
writeFileSync(join(consumer, "package.json"), JSON.stringify({ private: true, type: "module" }));
execFileSync("npm", ["install", "--prefix", consumer, "--ignore-scripts", "--no-audit", "--no-fund", ...files, "vue@3.5.42"], { stdio: "pipe" });

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
const vueBundle = readFileSync(join(consumer, "node_modules/@model-auth/vue/dist/model-auth-vue.js"), "utf8");
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
element.open = true;
await browser.happyDOM.waitUntilComplete();
assert.ok(element.shadowRoot.textContent.includes("OAuth"), "Raw standalone asset must start without Node globals or a Vite transform");
assert.ok(element.shadowRoot.textContent.includes("API Key"));
assert.equal(element.shadowRoot.querySelector("dialog")?.open, true, "Packed custom element must open a native modal");
assert.equal(element.shadowRoot.querySelectorAll(".model-auth-progress-segment").length, 3);
element.remove();
await browser.happyDOM.close();
writeFileSync(join(consumer, "entry.ts"), `
import { ModelAuthDialog, type ModelAuthProvider } from "@model-auth/vue";
import { registerModelAuthElement } from "@model-auth/vue/custom-element";
import { CredentialRouter, createCredentialMetadata } from "@model-auth/core";
import { authorizeWorkBuddy, refreshWorkBuddy } from "@model-auth/providers/workbuddy";
import { TraeProvider } from "@model-auth/providers/trae";
const providers: ModelAuthProvider[] = [];
const router = new CredentialRouter([createCredentialMetadata({ id: "one", providerId: "sample", authMethod: "api-key", modelIds: ["sample"] })]);
void [providers, router, ModelAuthDialog, registerModelAuthElement, authorizeWorkBuddy, refreshWorkBuddy, TraeProvider];
`);
execFileSync(process.execPath, [join(root, "node_modules/typescript/bin/tsc"), "--noEmit", "--strict", "--skipLibCheck", "--moduleResolution", "bundler", "--module", "esnext", "--target", "es2023", join(consumer, "entry.ts")], { stdio: "pipe", cwd: consumer });
execFileSync(process.execPath, [join(root, "node_modules/typescript/bin/tsc"), "--noEmit", "--strict", "--skipLibCheck", "--moduleResolution", "node", "--module", "commonjs", "--target", "es2023", join(consumer, "entry.ts")], { stdio: "pipe", cwd: consumer });
execFileSync(process.execPath, ["--input-type=module", "-e", `
import { CredentialRouter, createCredentialMetadata } from "@model-auth/core";
import { authorizeWorkBuddy, refreshWorkBuddy } from "@model-auth/providers/workbuddy";
if (typeof authorizeWorkBuddy !== "function" || typeof refreshWorkBuddy !== "function") throw new Error("Installed providers unavailable");
const router = new CredentialRouter([createCredentialMetadata({ id: "one", providerId: "sample", authMethod: "api-key", modelIds: ["sample"] })]);
if (router.candidates({ providerId: "sample", modelId: "sample" })[0]?.id !== "one") throw new Error("Installed core cannot route");
`], { stdio: "pipe", cwd: consumer });
console.log("Package consumer passed: installed tarballs, declarations, runtime, styles, standalone and licenses.");
