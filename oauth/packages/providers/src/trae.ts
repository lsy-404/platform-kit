import { createHash, generateKeyPairSync, randomBytes, randomUUID, sign } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

export const TRAE_PROVIDER_ID = "traecode";
/** Trae 2.3.61406 appProviderLogin.marscode authUrl. */
export const DEFAULT_TRAE_SSO_HOST = "https://www.marscode.com";
/** Trae 2.3.61406 desktop TRAE fallback client identifier. */
export const DEFAULT_TRAE_CLIENT_ID = "ono9krqynydwx5";
export type TraeErrorCode = "aborted" | "authentication" | "response" | "timeout" | "transport";
export class TraeProviderError extends Error { constructor(public readonly code: TraeErrorCode, message: string) { super(message); this.name = "TraeProviderError"; } }
export interface TraeDevice { readonly deviceId: string; readonly machineId: string; readonly privateKeyPem: string; readonly publicKeyPem: string; readonly name?: string; readonly model?: string; readonly brand?: string; readonly cpu?: string; readonly os?: string; readonly osVersion?: string; }
export interface TraeCredential { readonly access: string; readonly refresh: string; readonly expires: number; readonly refreshExpires: number; readonly host: string; readonly device: TraeDevice; readonly accountId?: string; readonly label?: string; }
export interface TraeAuthorizationOptions { readonly authFrom: string; readonly openExternal: (url: string) => Promise<unknown> | unknown; readonly ssoHost?: string; readonly clientId?: string; readonly timeoutMs?: number; readonly signal?: AbortSignal; }
export interface TraeRefreshOptions { readonly clientId?: string; readonly appVersion?: string; readonly fetchImpl?: typeof fetch; readonly signal?: AbortSignal; }
export interface TraeStatus { readonly authenticated: boolean; readonly detail: "authenticated" | "expired" | "unauthenticated"; }
const MAX_TIMEOUT_MS = 600_000, DEFAULT_TIMEOUT_MS = 300_000, DEFAULT_APP_VERSION = "3.5.81";

/** The trusted host must persist this device binding alongside its credential. */
export function createTraeDevice(input: Omit<TraeDevice, "privateKeyPem" | "publicKeyPem"> & Partial<Pick<TraeDevice, "privateKeyPem" | "publicKeyPem">> = { deviceId: randomUUID(), machineId: randomUUID() }): TraeDevice {
  if (input.privateKeyPem && input.publicKeyPem) return device(input as TraeDevice);
  const pair = generateKeyPairSync("ec", { namedCurve: "P-256", privateKeyEncoding: { type: "pkcs8", format: "pem" }, publicKeyEncoding: { type: "spki", format: "pem" } });
  return device({ ...input, privateKeyPem: pair.privateKey, publicKeyPem: pair.publicKey });
}

/** Opens Trae's verified desktop handoff page and receives its loopback credential callback. */
export async function authorizeTrae(options: TraeAuthorizationOptions): Promise<TraeCredential> {
  abort(options.signal);
  const authFrom = required(options.authFrom, "authFrom"), host = origin(options.ssoHost ?? DEFAULT_TRAE_SSO_HOST, "ssoHost"), clientId = required(options.clientId ?? DEFAULT_TRAE_CLIENT_ID, "clientId"), binding = createTraeDevice();
  const server = createServer(), port = await listen(server), callback = `http://127.0.0.1:${port}/authorize`;
  const query = new URLSearchParams({ login_version: "1", auth_from: authFrom, login_channel: "native_ide", plugin_version: "trae-handoff-1.0", auth_type: "local", client_id: clientId, redirect: "0", login_trace_id: randomUUID(), auth_callback_url: callback, machine_id: createHash("sha256").update(binding.machineId).digest("hex").slice(0, 32), device_id: binding.deviceId });
  try {
    const result = waitForCallback(server, callback, binding, timeout(options.timeoutMs), options.signal);
    await options.openExternal(`${host}/authorization?${query}`);
    return await result;
  } finally { await close(server); }
}

/** Refreshes using the desktop's P-256 signed device-proof envelope. */
export async function refreshTrae(value: TraeCredential, options: TraeRefreshOptions = {}): Promise<TraeCredential> {
  abort(options.signal); const credential = credentialOf(value); if (credential.refreshExpires <= Date.now()) throw new TraeProviderError("authentication", "Trae refresh credential has expired.");
  const clientId = required(options.clientId ?? DEFAULT_TRAE_CLIENT_ID, "clientId"), appVersion = options.appVersion ?? DEFAULT_APP_VERSION, path = "/trae/api/v3/oauth/ExchangeToken", timestamp = Math.floor(Date.now() / 1000), nonce = randomBytes(16).toString("hex");
  const signature = sign("sha256", Buffer.from(["POST", path, clientId, credential.refresh, String(timestamp), nonce].join("\n")), credential.device.privateKeyPem).toString("base64");
  const response = await (options.fetchImpl ?? fetch)(`${credential.host}${path}`, { method: "POST", ...(options.signal ? { signal: options.signal } : {}), headers: { "content-type": "application/json", "x-cloudide-token": credential.access }, body: JSON.stringify({ ClientID: clientId, ClientSecret: "", RefreshToken: credential.refresh, DeviceInfo: deviceInfo(credential.device, appVersion), DeviceProof: { Signature: signature, Timestamp: timestamp, Nonce: nonce }, IDEVersion: appVersion }) });
  if (!response.ok) throw new TraeProviderError("authentication", "Trae credential refresh was rejected.");
  const result = record(await response.json().catch(() => undefined))?.Result, item = record(result), access = text(item?.Token), refresh = text(item?.RefreshToken) ?? credential.refresh, expires = expiry(item?.TokenExpireAt, item?.TokenExpireDuration), refreshExpires = expiry(item?.RefreshExpireAt);
  if (!access || !expires || !refreshExpires) throw new TraeProviderError("response", "Trae credential refresh returned an incomplete result.");
  return { ...credential, access, refresh, expires, refreshExpires };
}

export async function traeStatus(value: TraeCredential, options: Pick<TraeRefreshOptions, "fetchImpl" | "signal" | "appVersion"> = {}): Promise<TraeStatus> {
  const credential = credentialOf(value); if (credential.expires <= Date.now()) return { authenticated: false, detail: "expired" };
  const response = await (options.fetchImpl ?? fetch)(`${credential.host}/cloudide/api/v3/trae/CheckLogin`, { method: "POST", ...(options.signal ? { signal: options.signal } : {}), headers: { "content-type": "application/json", "x-cloudide-token": credential.access }, body: JSON.stringify({ IDEVersion: options.appVersion ?? DEFAULT_APP_VERSION, ReqSource: "IDE", GetAIPayHost: true }) });
  if (!response.ok) return { authenticated: false, detail: "unauthenticated" };
  const body = record(await response.json().catch(() => undefined)); return body?.Result && record(body.Result)?.IsLogin !== false ? { authenticated: true, detail: "authenticated" } : { authenticated: false, detail: "unauthenticated" };
}

function waitForCallback(server: ReturnType<typeof createServer>, callback: string, binding: TraeDevice, ms: number, signal?: AbortSignal): Promise<TraeCredential> {
  return new Promise((resolve, reject) => { let done = false; const finish = (error?: Error, value?: TraeCredential) => { if (done) return; done = true; clearTimeout(timer); signal?.removeEventListener("abort", cancelled); error ? reject(error) : resolve(value!); }, cancelled = () => finish(new TraeProviderError("aborted", "Trae browser authorization was cancelled.")), timer = setTimeout(() => finish(new TraeProviderError("timeout", "Trae browser authorization timed out.")), ms);
    signal?.addEventListener("abort", cancelled, { once: true }); server.on("request", (request, response) => handleCallback(request, response, callback, binding, finish)); });
}
function handleCallback(request: IncomingMessage, response: ServerResponse, callback: string, binding: TraeDevice, finish: (error?: Error, value?: TraeCredential) => void): void {
  const url = new URL(request.url ?? "/", callback); if (request.method !== "GET" || url.pathname !== "/authorize") { response.writeHead(404).end(); return; }
  try { const value = callbackCredential(url, binding); response.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end("<html><body>Trae authorization complete. You may close this tab.</body></html>"); finish(undefined, value); } catch (error) { response.writeHead(400).end("<html><body>Trae authorization failed.</body></html>"); finish(error instanceof Error ? error : new TraeProviderError("response", "Trae callback was invalid.")); }
}
function callbackCredential(url: URL, binding: TraeDevice): TraeCredential {
  const packed = url.searchParams.get("credential"), source = packed ? decoded(packed) : { userJwt: url.searchParams.get("userJwt"), refreshToken: url.searchParams.get("refreshToken"), refreshExpireAt: url.searchParams.get("refreshExpireAt"), host: url.searchParams.get("host") }, jwt = typeof source.userJwt === "string" ? record(json(source.userJwt)) : record(source.userJwt);
  const access = text(jwt?.Token), refresh = text(source.refreshToken) ?? text(jwt?.RefreshToken), host = text(source.host), expires = expiry(jwt?.TokenExpireAt) ?? Date.now() + 7_200_000, refreshExpires = expiry(source.refreshExpireAt) ?? expiry(jwt?.RefreshExpireAt) ?? Date.now() + 2_592_000_000;
  if (!access || !refresh || !host) throw new TraeProviderError("response", "Trae authorization callback did not contain a complete credential."); return credentialOf({ access, refresh, expires, refreshExpires, host, device: binding });
}
function decoded(value: string): Record<string, unknown> { const raw = decodeURIComponent(value), parsed = record(json(raw)); return parsed ?? Object.fromEntries(new URLSearchParams(raw)); }
function deviceInfo(value: TraeDevice, version: string): Record<string, string> { return { DeviceID: value.deviceId, MachineID: value.machineId, PlatformCode: "IDE_PC", DeviceType: "PC", DeviceName: value.name ?? "", DeviceModel: value.model ?? "", ClientVersion: version, DevicePublicKey: value.publicKeyPem, DeviceBrand: value.brand ?? "", DeviceCPU: value.cpu ?? "", OSInfo: value.os ?? "", OSVersion: value.osVersion ?? "" }; }
function credentialOf(value: TraeCredential): TraeCredential { if (!text(value.access) || !text(value.refresh) || !Number.isFinite(value.expires) || !Number.isFinite(value.refreshExpires)) throw new TraeProviderError("response", "Trae credential is invalid."); return { ...value, host: origin(value.host, "credential host"), device: device(value.device) }; }
function device(value: TraeDevice): TraeDevice { if (!text(value.deviceId) || !text(value.machineId) || !text(value.privateKeyPem) || !text(value.publicKeyPem)) throw new TraeProviderError("response", "Trae device binding is invalid."); return value; }
function expiry(value: unknown, duration?: unknown): number | undefined { const time = typeof value === "number" ? value : typeof value === "string" ? Date.parse(value) : NaN, seconds = Number(duration); return Number.isFinite(time) && time > 0 ? time : Number.isFinite(seconds) && seconds > 0 ? Date.now() + seconds * 1000 : undefined; }
function record(value: unknown): Record<string, unknown> | undefined { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined; } function text(value: unknown): string | undefined { return typeof value === "string" && value.trim() ? value.trim() : undefined; } function json(value: string): unknown { try { return JSON.parse(value); } catch { return undefined; } }
function required(value: string, name: string): string { const item = text(value); if (!item) throw new TraeProviderError("transport", `Trae ${name} is required.`); return item; } function origin(value: string, name: string): string { const url = new URL(value); if (url.protocol !== "https:" || url.username || url.password || url.pathname !== "/" || url.search || url.hash) throw new TraeProviderError("transport", `Trae ${name} must be an HTTPS origin.`); return url.origin; } function timeout(value?: number): number { return Number.isFinite(value) ? Math.max(1, Math.min(value!, MAX_TIMEOUT_MS)) : DEFAULT_TIMEOUT_MS; } function abort(signal?: AbortSignal): void { if (signal?.aborted) throw new TraeProviderError("aborted", "Trae operation was cancelled."); }
function listen(server: ReturnType<typeof createServer>): Promise<number> { return new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", () => { server.removeListener("error", reject); const value = server.address(); if (!value || typeof value === "string") reject(new TraeProviderError("transport", "Trae callback listener could not bind.")); else resolve(value.port); }); }); } function close(server: ReturnType<typeof createServer>): Promise<void> { return new Promise(resolve => server.close(() => resolve())); }
