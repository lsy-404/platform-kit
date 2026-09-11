# model-auth-native

Rust browser OAuth for OpenAI and Anthropic, for use in a trusted native backend. The library contains PKCE, state validation, loopback callbacks, token exchange and renewal. It does not open the browser itself, store credentials or depend on a provider CLI.

```rust
use model_auth_native::{authorize, refresh, Error, Provider, UreqTransport};
use std::sync::atomic::Ordering;
use std::time::Duration;

let credential = authorize(
    Provider::OpenAi,
    &UreqTransport,
    |url| host.open_external(url).map_err(Error::new),
    || cancelled.load(Ordering::Relaxed),
    Duration::from_secs(600),
)?;
host.store_credential(&credential)?;
let renewed = refresh(Provider::OpenAi, &credential, &UreqTransport)?;
host.store_credential(&renewed)?;
```

`host` and `cancelled` above are host-owned values. Use `Provider::Anthropic` with the same API. The browser opener must launch the system browser and return promptly; it must not wait for the browser to exit. OpenAI listens on port 1455 and Anthropic on port 53692. An occupied callback port returns an error.

Authorization checks cancellation during callback handling and while the default HTTP transport waits for a response. Token requests are bounded to thirty seconds and the authorization's remaining deadline. A custom `TokenTransport` must honor its request timeout and cancellation callback. The default transport does not follow redirects and bounds response size. Token exchange and renewal remain subject to the vendor's account restrictions.

`Credential` contains access and refresh tokens, an expiry in Unix milliseconds, and an optional account ID. Debug output redacts tokens, and credential and request buffers are cleared on drop. Keep all credentials in the backend, persist renewed tokens before model requests, and verify account identity before replacing a saved account. Missing refresh tokens in a successful renewal retain the previous refresh token; malformed returned tokens are rejected.

Run the protocol tests from the repository root:

```sh
cargo test --manifest-path test/rust/Cargo.toml --locked
```
