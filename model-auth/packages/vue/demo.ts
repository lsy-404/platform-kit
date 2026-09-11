import { createApp, h, ref } from "vue";
import { ModelAuthDialog } from "./src/index";
import type { ModelAuthProvider, Theme } from "./src/types";

const initial: ModelAuthProvider[] = [
  { id: "anthropic", name: "Anthropic", description: "连接已有账号，或使用平台 API Key。", available: true,
    authMethods: ["oauth", "api-key"], models: ["model-standard", "model-fast"],
    oauthCredentials: [
      { id: "account-a", label: "主账号", enabled: true, healthy: true, weight: 2 },
      { id: "account-b", label: "备用账号", enabled: false, healthy: true, weight: 1 },
    ], apiKeyCredentials: [] },
  { id: "openai", name: "OpenAI", description: "使用平台 API Key 连接模型。", available: true,
    authMethods: ["api-key"], models: ["model-standard"], apiKeyCredentials: [] },
  { id: "workbuddy", name: "WorkBuddy", description: "通过宿主授权连接 WorkBuddy。", available: true,
    authMethods: ["oauth"], models: [], oauthCredentials: [] },
  { id: "traecode", name: "TraeCode", description: "通过客户端授权连接。", available: false,
    unavailableReason: "此演示没有提供客户端授权适配器。", authMethods: ["oauth"], models: [], oauthCredentials: [] },
];
createApp({
  setup() {
    const open = ref(false), styled = ref(true), theme = ref<Theme>("dark");
    const providers = ref(initial), status = ref("本页为组件演示。凭据只保留于内存，请勿输入真实密钥。");
    const selected = ref<{ providerId: string; model: string } | null>(null);
    const busy = ref(false);
    return () => h("main", { style: "font:15px system-ui;padding:48px;max-width:1100px;margin:auto" }, [
      h("h1", "model-auth"),
      h("p", "模型连接 · WinUI 默认界面 · Vue / Custom Element"),
      h("p", { role: "status" }, status.value),
      h("div", { style: "display:flex;gap:16px;align-items:center;margin:24px 0" }, [
        h("button", { onClick: () => { open.value = true; } }, "添加模型连接"),
        h("label", [h("input", { type: "checkbox", checked: styled.value, onChange: (event: Event) => { styled.value = (event.target as HTMLInputElement).checked; } }), "默认 WinUI"]),
        h("button", { onClick: () => { theme.value = theme.value === "dark" ? "light" : "dark"; } }, "切换明暗"),
      ]),
      h(ModelAuthDialog, {
        open: open.value, providers: providers.value, styled: styled.value, theme: theme.value, busy: busy.value,
        catalogStatus: { state: "ready", source: "cached" }, model: selected.value,
        onClose: () => { open.value = false; },
        onAuthorizeOauth: (providerId: string) => {
          const provider = providers.value.find(item => item.id === providerId)!;
          (provider.oauthCredentials ??= []).push({ id: crypto.randomUUID(), label: "演示账号", enabled: true, healthy: true, weight: 1 });
          status.value = "演示授权已完成。真实授权由宿主适配器执行。";
        },
        onReconnectOauth: () => { status.value = "宿主收到重新授权请求。"; },
        onAddApiKey: (payload: { providerId: string; label: string }) => {
          const provider = providers.value.find(item => item.id === payload.providerId)!;
          (provider.apiKeyCredentials ??= []).push({ id: crypto.randomUUID(), label: payload.label || "演示密钥", enabled: true, healthy: true, weight: 1, models: [...provider.models] });
          status.value = "演示元数据已添加，输入的密钥未保存。";
        },
        onUpdateCredential: (payload: { providerId: string; credentialId: string; enabled: boolean; weight: number }) => {
          const provider = providers.value.find(item => item.id === payload.providerId)!;
          const credential = [...provider.oauthCredentials ?? [], ...provider.apiKeyCredentials ?? []].find(item => item.id === payload.credentialId)!;
          credential.enabled = payload.enabled; credential.weight = payload.weight;
        },
        onUpdateProvider: (payload: { providerId: string; oauthEnabled: boolean }) => {
          providers.value.find(item => item.id === payload.providerId)!.oauthEnabled = payload.oauthEnabled;
        },
        onUpdateProviderStrategy: (payload) => { providers.value.find(item => item.id === payload.providerId)!.loadStrategy = payload.strategy; },
        onRemoveOauth: (id: string, credentialId: string) => {
          const provider = providers.value.find(item => item.id === id)!;
          provider.oauthCredentials = provider.oauthCredentials?.filter(item => item.id !== credentialId) ?? [];
        },
        onRemoveApiKey: (id: string, credentialId: string) => {
          const provider = providers.value.find(item => item.id === id)!;
          provider.apiKeyCredentials = provider.apiKeyCredentials?.filter(item => item.id !== credentialId) ?? [];
        },
        onSelectModel: (value) => { selected.value = value; status.value = value.providerId + " / " + value.model; },
      }),
    ]);
  },
}).mount("#app");
