import { createHash, createPublicKey, generateKeyPairSync, randomBytes, randomUUID, sign } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

export const TRAE_PROVIDER_ID = "traecode";
export const DEFAULT_TRAE_SSO_HOST = "https://www.trae.ai";
export const DEFAULT_TRAE_CLIENT_ID = "ono9krqynydwx5";
export type TraeErrorCode = "aborted" | "authentication" | "response" | "timeout" | "transport";
export class TraeProviderError extends Error {
  constructor(public readonly code: TraeErrorCode, message: string) { super(message); this.name = "TraeProviderError"; }
}
export interface TraeDevice {
  readonly deviceId: string; readonly machineId: string;
  readonly privateKeyPem: string; readonly publicKeyPem: string;
  readonly name?: string; readonly model?: string; readonly brand?: string;
  readonly cpu?: string; readonly os?: string; readonly osVersion?: string;
}
export interface TraeCredential {
  readonly access: string; readonly refresh: string; readonly expires: number; readonly refreshExpires: number;
  readonly host: string; readonly clientId: string; readonly device: TraeDevice;
  readonly accountId?: string; readonly label?: string; readonly region?: string;
  readonly userTag?: "row" | "usttp"; readonly storeCountry?: string;
}
export interface TraeAuthorizationOptions {
  readonly openExternal: (url: string) => Promise<unknown> | unknown;
  readonly authFrom?: string; readonly ssoHost?: string; readonly clientId?: string;
  readonly appVersion?: string; readonly timeoutMs?: number; readonly signal?: AbortSignal;
  readonly fetchImpl?: typeof fetch;
}
export interface TraeRefreshOptions {
  readonly clientId?: string; readonly appVersion?: string; readonly fetchImpl?: typeof fetch; readonly signal?: AbortSignal;
}
export interface TraeStatus { readonly authenticated: boolean; readonly detail: "authenticated" | "expired" | "unauthenticated"; }
const DEFAULT_APP_VERSION = "3.5.81", DEFAULT_BUILD_VERSION = "2.3.61406";
const EXCHANGE_PATH = "/trae/api/v3/oauth/ExchangeToken";
const API_HOSTS = ["https://growsg-normal.trae.ai", "https://grow-normal.traeapi.us", "https://grow-normal.trae.ai"] as const;

export function createTraeDevice(input: Omit<TraeDevice, "privateKeyPem" | "publicKeyPem"> & Partial<Pick<TraeDevice, "privateKeyPem" | "publicKeyPem">> = { deviceId: randomUUID(), machineId: randomUUID() }): TraeDevice {
  if (input.privateKeyPem || input.publicKeyPem) return device(input as TraeDevice);
  const pair = generateKeyPairSync("ec", { namedCurve: "P-256", privateKeyEncoding: { type: "pkcs8", format: "pem" }, publicKeyEncoding: { type: "spki", format: "pem" } });
  return device({ ...input, privateKeyPem: pair.privateKey, publicKeyPem: pair.publicKey });
}

export async function authorizeTrae(options: TraeAuthorizationOptions): Promise<TraeCredential> {
  abort(options.signal);
  const host = origin(options.ssoHost ?? DEFAULT_TRAE_SSO_HOST);
  const clientId = required(options.clientId ?? DEFAULT_TRAE_CLIENT_ID, "clientId");
  const appVersion = required(options.appVersion ?? DEFAULT_APP_VERSION, "appVersion");
  const binding = createTraeDevice(), trace = randomUUID(), verifier = randomBytes(48).toString("base64url");
  const server = createServer({ maxHeaderSize: 32_768 });
  const controller = new AbortController();
  const cancel = () => controller.abort(new TraeProviderError("aborted", "Trae browser authorization was cancelled."));
  options.signal?.addEventListener("abort", cancel, { once: true });
  if (options.signal?.aborted) cancel();
  const timer = setTimeout(() => controller.abort(new TraeProviderError("timeout", "Trae browser authorization timed out.")), timeout(options.timeoutMs));
  let dispose = () => {};
  try {
    const port = await listen(server), callback = new URL(`http://127.0.0.1:${port}/authorize`);
    const query = new URLSearchParams({
      login_version: "1", auth_from: required(options.authFrom ?? "trae", "authFrom"), login_channel: "native_ide",
      plugin_version: DEFAULT_BUILD_VERSION, auth_type: "local", client_id: clientId, redirect: "0", login_trace_id: trace,
      auth_callback_url: callback.href, machine_id: binding.machineId, device_id: binding.deviceId,
      x_device_id: binding.deviceId, x_machine_id: binding.machineId, x_app_version: appVersion, x_app_type: "stable",
      code_challenge: createHash("sha256").update(verifier).digest("base64url"), code_challenge_method: "S256",
    });
    const waiter = waitForCallback(server, callback, trace, controller.signal);
    dispose = waiter.dispose;
    // Attach rejection handlers before opening the browser, which may throw or remain pending.
    const completion = waiter.result.then(async ({ authCode, userTag }) => {
      const apiHost = userTag === "usttp" ? API_HOSTS[1] : API_HOSTS[0];
      const requestOptions = { ...options, signal: controller.signal };
      const result = await post(apiHost, EXCHANGE_PATH, "", {
        ClientID: clientId, AuthCode: authCode, CodeVerifier: verifier, DeviceInfo: deviceInfo(binding, appVersion), IDEVersion: appVersion,
      }, requestOptions);
      const credential = tokenResult(result, { host: apiHost, device: binding, clientId });
      const user = await post(apiHost, "/cloudide/api/v3/trae/GetUserInfo", credential.access, { IDEVersion: appVersion, ReqSource: "IDE" }, requestOptions);
      const accountId = text(user.UserID), label = text(user.ScreenName) ?? text(user.NonPlainTextEmail);
      const region = text(user.AIRegion), storeCountry = text(user.StoreCountry);
      if (!accountId) throw new TraeProviderError("response", "Trae account response did not identify the authenticated account.");
      return { ...credential, accountId, userTag, ...(label ? { label } : {}), ...(region ? { region } : {}), ...(storeCountry ? { storeCountry } : {}) };
    });
    const opening = Promise.resolve().then(() => { abort(controller.signal); return options.openExternal(`${host}/authorization?${query}`); });
    const failedOpening = opening.then(() => new Promise<never>(() => {}), () => {
      throw new TraeProviderError("transport", "Trae authorization browser could not be opened.");
    });
    return await Promise.race([completion, failedOpening]);
  } finally {
    controller.abort(); dispose(); clearTimeout(timer); options.signal?.removeEventListener("abort", cancel);
    server.closeAllConnections(); await close(server);
  }
}

export async function refreshTrae(value: TraeCredential, options: TraeRefreshOptions = {}): Promise<TraeCredential> {
  abort(options.signal);
  const credential = credentialOf(value);
  if (credential.refreshExpires <= Date.now()) throw new TraeProviderError("authentication", "Trae refresh credential has expired.");
  if (options.clientId && options.clientId !== credential.clientId) throw new TraeProviderError("authentication", "Trae client identifier does not match the credential binding.");
  const appVersion = options.appVersion ?? DEFAULT_APP_VERSION, timestamp = Math.floor(Date.now() / 1000), nonce = randomBytes(16).toString("hex");
  const signature = sign("sha256", Buffer.from(["POST", EXCHANGE_PATH, credential.clientId, credential.refresh, String(timestamp), nonce].join("\n")), credential.device.privateKeyPem).toString("base64");
  const result = await post(credential.host, EXCHANGE_PATH, credential.access, {
    ClientID: credential.clientId, ClientSecret: "", RefreshToken: credential.refresh,
    DeviceInfo: deviceInfo(credential.device, appVersion), DeviceProof: { Signature: signature, Timestamp: timestamp, Nonce: nonce }, IDEVersion: appVersion,
  }, options);
  return { ...credential, ...tokenResult(result, credential) };
}

export async function traeStatus(value: TraeCredential, options: Pick<TraeRefreshOptions, "fetchImpl" | "signal" | "appVersion"> = {}): Promise<TraeStatus> {
  abort(options.signal);
  const credential = credentialOf(value);
  if (credential.expires <= Date.now()) return { authenticated: false, detail: "expired" };
  try {
    const result = await post(credential.host, "/cloudide/api/v3/trae/CheckLogin", credential.access, { IDEVersion: options.appVersion ?? DEFAULT_APP_VERSION, ReqSource: "IDE", GetAIPayHost: true }, options);
    return result.IsLogin === true ? { authenticated: true, detail: "authenticated" } : { authenticated: false, detail: "unauthenticated" };
  } catch (error) {
    if (error instanceof TraeProviderError && (error.code === "authentication" || error.code === "response")) return { authenticated: false, detail: "unauthenticated" };
    throw error;
  }
}

function waitForCallback(server: ReturnType<typeof createServer>, callback: URL, trace: string, signal: AbortSignal): {
  result: Promise<{ authCode: string; userTag: "row" | "usttp" }>; dispose: () => void;
} {
  let dispose = () => {};
  const result = new Promise<{ authCode: string; userTag: "row" | "usttp" }>((resolve, reject) => {
    let done = false;
    const finish = (error?: Error, value?: { authCode: string; userTag: "row" | "usttp" }) => {
      if (done) return; done = true; signal.removeEventListener("abort", cancelled); error ? reject(error) : resolve(value!);
    };
    const cancelled = () => finish(cancellation(signal));
    const handler = (request: IncomingMessage, response: ServerResponse) => {
      response.setHeader("cache-control", "no-store"); response.setHeader("referrer-policy", "no-referrer");
      response.setHeader("content-security-policy", "default-src 'none'");
      let url: URL;
      try { url = new URL(request.url ?? "/", callback); } catch { response.writeHead(400).end(); return; }
      if (done || request.method !== "GET" || request.headers.host !== callback.host || url.origin !== callback.origin || url.pathname !== callback.pathname) { response.writeHead(404).end(); return; }
      const query = url.searchParams;
      if (query.getAll("loginTraceID").length !== 1 || query.get("loginTraceID") !== trace) { response.writeHead(400).end("Invalid authorization response."); return; }
      if (query.has("error_code")) {
        response.writeHead(400).end("Authorization was rejected.");
        finish(new TraeProviderError("authentication", "Trae browser authorization was rejected.")); return;
      }
      const authCode = text(record(json(query.get("authCodeInfo") ?? ""))?.AuthCode), userTag = query.get("userTag");
      if (query.getAll("authCodeInfo").length !== 1 || !authCode || query.getAll("userTag").length !== 1 || (userTag !== "row" && userTag !== "usttp") || query.get("scope") !== "trae") {
        response.writeHead(400).end("Invalid authorization response."); return;
      }
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end("<!doctype html><title>Trae authorization</title><p>Authorization response received. Return to the application to finish connecting.</p>");
      finish(undefined, { authCode, userTag });
    };
    dispose = () => { server.removeListener("request", handler); signal.removeEventListener("abort", cancelled); };
    server.on("request", handler); signal.addEventListener("abort", cancelled, { once: true });
    if (signal.aborted) cancelled();
  });
  return { result, dispose: () => dispose() };
}

async function post(host: string, path: string, access: string, body: Record<string, unknown>, options: Pick<TraeRefreshOptions, "fetchImpl" | "signal">): Promise<Record<string, unknown>> {
  abort(options.signal);
  const signal = options.signal ? AbortSignal.any([options.signal, AbortSignal.timeout(60_000)]) : AbortSignal.timeout(60_000);
  let response: Response;
  try {
    response = await (options.fetchImpl ?? fetch)(`${apiOrigin(host)}${path}`, { method: "POST", redirect: "error", signal,
      headers: { "content-type": "application/json", "x-cloudide-token": access }, body: JSON.stringify(body) });
  } catch {
    if (options.signal?.aborted) throw cancellation(options.signal);
    throw new TraeProviderError(signal.aborted ? "timeout" : "transport", "Trae service request could not be completed.");
  }
  if (!response.ok) throw new TraeProviderError(response.status === 401 || response.status === 403 ? "authentication" : "transport", "Trae service rejected the request.");
  let envelope: Record<string, unknown> | undefined;
  try { envelope = record(await response.json()); } catch { throw new TraeProviderError("response", "Trae returned an invalid response."); }
  abort(options.signal);
  if (record(envelope?.ResponseMetadata)?.Error) throw new TraeProviderError("authentication", "Trae service rejected the authorization.");
  const result = record(envelope?.Result);
  if (!result) throw new TraeProviderError("response", "Trae returned an incomplete response.");
  return result;
}
function tokenResult(result: Record<string, unknown>, binding: Pick<TraeCredential, "host" | "device" | "clientId">): TraeCredential {
  const access = text(result.Token), refresh = text(result.RefreshToken), expires = expiry(result.TokenExpireAt, result.TokenExpireDuration), refreshExpires = expiry(result.RefreshExpireAt);
  if (!access || !refresh || !expires || expires <= Date.now() || !refreshExpires || refreshExpires <= Date.now()) throw new TraeProviderError("response", "Trae returned an incomplete or expired credential.");
  return credentialOf({ ...binding, access, refresh, expires, refreshExpires });
}
function deviceInfo(value: TraeDevice, version: string): Record<string, string> {
  return { DeviceID: value.deviceId, MachineID: value.machineId, PlatformCode: "IDE_PC", DeviceType: "PC", DeviceName: value.name ?? "", DeviceModel: value.model ?? "", ClientVersion: version, DevicePublicKey: value.publicKeyPem, DeviceBrand: value.brand ?? "", DeviceCPU: value.cpu ?? "", OSInfo: value.os ?? "", OSVersion: value.osVersion ?? "" };
}
function credentialOf(value: TraeCredential): TraeCredential {
  if (!value || !text(value.access) || !text(value.refresh) || !text(value.clientId) || !Number.isFinite(value.expires) || !Number.isFinite(value.refreshExpires)) throw new TraeProviderError("response", "Trae credential is invalid.");
  return { ...value, host: apiOrigin(value.host), device: device(value.device) };
}
function device(value: TraeDevice): TraeDevice {
  try {
    if (!value || !text(value.deviceId) || !text(value.machineId) || !text(value.privateKeyPem) || !text(value.publicKeyPem)) throw new Error();
    const derived = createPublicKey(value.privateKeyPem), supplied = createPublicKey(value.publicKeyPem);
    if (derived.asymmetricKeyType !== "ec" || derived.asymmetricKeyDetails?.namedCurve !== "prime256v1" || !derived.export({ type: "spki", format: "der" }).equals(supplied.export({ type: "spki", format: "der" }))) throw new Error();
    return value;
  } catch { throw new TraeProviderError("response", "Trae device binding is invalid."); }
}
function expiry(value: unknown, duration?: unknown): number | undefined {
  const time = typeof value === "number" ? value : typeof value === "string" ? (/^\d+$/.test(value) ? Number(value) : Date.parse(value)) : NaN;
  if (Number.isFinite(time) && time > Date.now()) return time;
  // The service duration is milliseconds and compensates for an expired server timestamp.
  return typeof duration === "number" && Number.isFinite(duration) && duration > 0 ? Date.now() + duration : undefined;
}
function record(value: unknown): Record<string, unknown> | undefined { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined; }
function text(value: unknown): string | undefined { return typeof value === "string" && value.trim() ? value.trim() : undefined; }
function json(value: string): unknown { try { return JSON.parse(value); } catch { return undefined; } }
function required(value: string, name: string): string { const item = text(value); if (!item) throw new TraeProviderError("transport", `Trae ${name} is required.`); return item; }
function origin(value: string): string {
  try { const url = new URL(value); if (url.protocol !== "https:" || url.username || url.password || url.pathname !== "/" || url.search || url.hash) throw new Error(); return url.origin; }
  catch { throw new TraeProviderError("transport", "Trae service must be an HTTPS origin."); }
}
function apiOrigin(value: string): string { const host = origin(value); if (!(API_HOSTS as readonly string[]).includes(host)) throw new TraeProviderError("response", "Trae credential service host is not trusted."); return host; }
function timeout(value?: number): number { return Number.isFinite(value) ? Math.max(1, Math.min(value!, 600_000)) : 300_000; }
function cancellation(signal: AbortSignal): TraeProviderError { return signal.reason instanceof TraeProviderError ? signal.reason : new TraeProviderError("aborted", "Trae operation was cancelled."); }
function abort(signal?: AbortSignal): void { if (signal?.aborted) throw cancellation(signal); }
function listen(server: ReturnType<typeof createServer>): Promise<number> {
  return new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", () => {
    server.removeListener("error", reject); const value = server.address();
    if (!value || typeof value === "string") reject(new TraeProviderError("transport", "Trae callback listener could not bind.")); else resolve(value.port);
  }); });
}
function close(server: ReturnType<typeof createServer>): Promise<void> { return new Promise(resolve => server.close(() => resolve())); }

export { listTraeModels, streamTrae, completeTrae } from "./trae-api.js";
export type { TraeModel, TraeTextMessage, TraeCompletionOptions, TraeCompletion, TraeStreamEvent, TraeApiOptions, TraeUsage } from "./trae-api.js";
