import { expect, it } from "vitest";
import { useModelAuth } from "../../model-auth/packages/vue/src/useModelAuth";
import type { ModelAuthAction, ModelAuthState } from "../../model-auth/packages/vue/src/useModelAuth";

it("keeps model selection open after the host saves and refreshes successfully", async () => {
  let fail = true;
  const binding = useModelAuth({
    async getState() { return { providers: [], model: null, catalogStatus: { state: "ready" } }; },
    async execute() { if (fail) throw new Error("failed"); },
  });
  binding.open.value = true;
  expect(await binding.listeners["select-model"]({ providerId: "sample", model: "sample" })).toBe(false);
  expect(binding.open.value).toBe(true);
  fail = false;
  expect(await binding.listeners["select-model"]({ providerId: "sample", model: "sample" })).toBe(true);
  expect(binding.open.value).toBe(true);
});

it("a late confirmation cannot close a newly opened dialog", async () => {
  let finish: (() => void) | undefined;
  const binding = useModelAuth({
    async getState() { return { providers: [], model: null, catalogStatus: { state: "ready" } }; },
    async execute() { await new Promise<void>(resolve => { finish = resolve; }); },
  });
  binding.open.value = true;
  const pending = binding.listeners["select-model"]({ providerId: "sample", model: "sample" });
  await Promise.resolve();
  binding.listeners.close();
  binding.open.value = true;
  finish?.();
  await pending;
  expect(binding.open.value).toBe(true);
});

it("dispatches a host operation and refreshes controlled state without storing its secret payload", async () => {
  const actions: ModelAuthAction[] = [];
  const state: ModelAuthState = { providers: [], model: null, catalogStatus: { state: "ready" } };
  const binding = useModelAuth({
    async getState() { return state; },
    async execute(action) { actions.push(action); state.model = { providerId: "sample", model: "sample" }; },
  });
  await binding.listeners["add-api-key"]({ providerId: "sample", label: "test", apiKey: "fake-test-key" });
  expect(actions[0]?.type).toBe("add-api-key");
  expect(binding.props.value.model).toEqual(state.model);
  expect(JSON.stringify(binding.state.value)).not.toContain("fake-test-key");
  expect(binding.busy.value).toBe(false);
});

it("coalesces state loads, blocks duplicate mutations and recovers from host failure", async () => {
  let finish: (() => void) | undefined;
  let calls = 0;
  let fail = true;
  const binding = useModelAuth({
    async getState() { return { providers: [], model: null, catalogStatus: { state: "ready" } }; },
    async execute() {
      calls += 1;
      if (fail) throw new Error("secret-bearing internal failure");
      await new Promise<void>(resolve => { finish = resolve; });
    },
  });
  expect(await binding.perform({ type: "refresh-catalog" })).toBe(false);
  expect(binding.error.value).not.toContain("secret");
  fail = false;
  const pending = binding.perform({ type: "refresh-catalog" });
  await Promise.resolve(); await Promise.resolve();
  expect(await binding.perform({ type: "refresh-catalog" })).toBe(false);
  expect(calls).toBe(2);
  finish?.();
  expect(await pending).toBe(true);
  expect(binding.error.value).toBeNull();
});

it("cancels browser authorization on close and can be reopened without an error", async () => {
  let signal: AbortSignal | undefined;
  const binding = useModelAuth({
    async getState() { return { providers: [], model: null, catalogStatus: { state: "ready" } }; },
    async execute(_action, context) {
      signal = context.signal;
      await new Promise((_resolve, reject) => signal?.addEventListener("abort", () => reject(new Error("cancelled")), { once: true }));
    },
  });
  binding.open.value = true;
  const pending = binding.listeners["authorize-oauth"]("workbuddy");
  await Promise.resolve();
  binding.listeners.close();
  expect(signal?.aborted).toBe(true);
  expect(await pending).toBe(false);
  expect(binding.busy.value).toBe(false);
  expect(binding.error.value).toBeNull();
  expect(await binding.refresh()).toBe(true);
});

it("does not start a host mutation after the dialog was already closed", async () => {
  let mutations = 0;
  const binding = useModelAuth({
    async getState() { return { providers: [], model: null, catalogStatus: { state: "ready" } }; },
    async execute() { mutations++; },
  });
  const pending = binding.listeners["authorize-oauth"]("workbuddy");
  binding.listeners.close();
  expect(await pending).toBe(false);
  expect(mutations).toBe(0);
  expect(binding.busy.value).toBe(false);
});

it("forwards Pine-style authentication prompts, notices and cancellation through the generic host", async () => {
  let receive: ((event: import("../../model-auth/packages/vue/src/types").ProviderAuthEvent) => void) | undefined;
  let response: unknown;
  let cancelled = "";
  const binding = useModelAuth({
    async getState() { return { providers: [], model: null, catalogStatus: { state: "ready" } }; },
    async execute() {},
    subscribeAuthEvents(listener) { receive = listener; return () => { receive = undefined; }; },
    async respondAuth(value) { response = value; },
    async cancelAuth(loginId) { cancelled = loginId; },
  });
  receive?.({ type: "provider-auth-notice", loginId: "login-1", notice: { type: "auth_url", url: "https://auth.example.test/login", instructions: "在浏览器中继续" } });
  receive?.({ type: "provider-auth-prompt", loginId: "login-1", promptId: "prompt-1", prompt: { type: "secret", message: "Code" } });
  expect(binding.props.value.auth).toMatchObject({ status: "running", loginId: "login-1", prompt: { promptId: "prompt-1" } });
  expect(await binding.listeners["respond-auth"]({ loginId: "login-1", promptId: "prompt-1", value: "private-code" })).toBe(true);
  expect(response).toEqual({ loginId: "login-1", promptId: "prompt-1", value: "private-code" });
  binding.listeners["cancel-auth"]("login-1");
  expect(cancelled).toBe("login-1");
});
