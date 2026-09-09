# Model Auth Native

`model-auth-native` runs the OpenAI Codex and Anthropic browser OAuth protocol inside a native host. It owns PKCE, exact loopback callback validation, token exchange and refresh. Hosts supply browser opening and token transport, then store returned credentials in their own encrypted backend storage.

The crate does not expose a renderer bridge or a credential store. OpenAI refresh retains the prior refresh token when the response omits one and requires a ChatGPT account id.
