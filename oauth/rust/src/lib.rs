//! Browser OAuth protocol only. Hosts own credential storage and UI.

use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use base64::engine::general_purpose::{URL_SAFE, URL_SAFE_NO_PAD};
use base64::Engine;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use url::Url;
use uuid::Uuid;
use zeroize::Zeroize;

const ANTHROPIC_AUTHORIZE_URL: &str = "https://claude.ai/oauth/authorize";
const ANTHROPIC_TOKEN_URL: &str = "https://platform.claude.com/v1/oauth/token";
const ANTHROPIC_CLIENT_ID_B64: &str = "OWQxYzI1MGEtZTYxYi00NGQ5LTg4ZWQtNTk0NGQxOTYyZjVl";
const ANTHROPIC_REDIRECT_URI: &str = "http://localhost:53692/callback";
const ANTHROPIC_SCOPE: &str = "org:create_api_key user:profile user:inference user:sessions:claude_code user:mcp_servers user:file_upload";
const OPENAI_AUTHORIZE_URL: &str = "https://auth.openai.com/oauth/authorize";
const OPENAI_TOKEN_URL: &str = "https://auth.openai.com/oauth/token";
const OPENAI_CLIENT_ID_B64: &str = "YXBwX0VNb2FtRUVaNzNmMENrWGFYcDdocmFubg==";
const OPENAI_REDIRECT_URI: &str = "http://localhost:1455/auth/callback";
const OPENAI_SCOPE: &str = "openid profile email offline_access";
const MAX_TOKEN_LIFETIME_SECONDS: i64 = 365 * 24 * 60 * 60;
const RESPONSE_LIMIT: usize = 128 * 1024;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Provider {
    OpenAi,
    Anthropic,
}

#[derive(Clone, PartialEq, Eq)]
pub struct Credential {
    pub access: String,
    pub refresh: String,
    pub expires_at: i64,
    pub account_id: Option<String>,
}

impl std::fmt::Debug for Credential {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("Credential")
            .field("access", &"[REDACTED]")
            .field("refresh", &"[REDACTED]")
            .field("expires_at", &self.expires_at)
            .field("account_id", &self.account_id)
            .finish()
    }
}

impl Drop for Credential {
    fn drop(&mut self) {
        self.access.zeroize();
        self.refresh.zeroize();
        if let Some(account_id) = &mut self.account_id {
            account_id.zeroize();
        }
    }
}

#[derive(Clone)]
pub struct TokenRequest {
    pub url: String,
    pub content_type: &'static str,
    pub body: String,
}

impl std::fmt::Debug for TokenRequest {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("TokenRequest")
            .field("url", &self.url)
            .field("content_type", &self.content_type)
            .field("body", &"[REDACTED]")
            .finish()
    }
}

pub trait TokenTransport: Send + Sync {
    fn send(&self, request: TokenRequest) -> Result<String, Error>;
}

pub struct UreqTransport;

impl TokenTransport for UreqTransport {
    fn send(&self, request: TokenRequest) -> Result<String, Error> {
        let response = ureq::AgentBuilder::new()
            .timeout(Duration::from_secs(30))
            .redirects(0)
            .https_only(true)
            .build()
            .post(&request.url)
            .set("accept", "application/json")
            .set("content-type", request.content_type)
            .send_string(&request.body)
            .map_err(|_| Error::new("OAuth token request failed."))?;
        if !(200..300).contains(&response.status()) {
            return Err(Error::new("OAuth token request failed."));
        }
        let mut body = String::new();
        response
            .into_reader()
            .take((RESPONSE_LIMIT + 1) as u64)
            .read_to_string(&mut body)
            .map_err(|error| Error::new(format!("Cannot read OAuth token response: {error}")))?;
        if body.len() > RESPONSE_LIMIT {
            return Err(Error::new("OAuth token response exceeds the size limit."));
        }
        Ok(body)
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Error(String);

impl Error {
    pub fn new(message: impl Into<String>) -> Self {
        Self(message.into())
    }
}
impl std::fmt::Display for Error {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.0)
    }
}
impl std::error::Error for Error {}

struct Config {
    authorize_url: &'static str,
    token_url: &'static str,
    client_id_b64: &'static str,
    redirect_uri: &'static str,
    callback_path: &'static str,
    scope: &'static str,
}
impl Config {
    fn for_provider(provider: Provider) -> Self {
        match provider {
            Provider::Anthropic => Self {
                authorize_url: ANTHROPIC_AUTHORIZE_URL,
                token_url: ANTHROPIC_TOKEN_URL,
                client_id_b64: ANTHROPIC_CLIENT_ID_B64,
                redirect_uri: ANTHROPIC_REDIRECT_URI,
                callback_path: "/callback",
                scope: ANTHROPIC_SCOPE,
            },
            Provider::OpenAi => Self {
                authorize_url: OPENAI_AUTHORIZE_URL,
                token_url: OPENAI_TOKEN_URL,
                client_id_b64: OPENAI_CLIENT_ID_B64,
                redirect_uri: OPENAI_REDIRECT_URI,
                callback_path: "/auth/callback",
                scope: OPENAI_SCOPE,
            },
        }
    }
    fn client_id(&self) -> Result<String, Error> {
        String::from_utf8(
            URL_SAFE
                .decode(self.client_id_b64)
                .map_err(|_| Error::new("Invalid OAuth client id."))?,
        )
        .map_err(|_| Error::new("Invalid OAuth client id."))
    }
    fn port(&self) -> Result<u16, Error> {
        Url::parse(self.redirect_uri)
            .map_err(|_| Error::new("Invalid OAuth redirect URI."))?
            .port()
            .ok_or_else(|| Error::new("OAuth redirect URI has no port."))
    }
}

/// Runs a host-opened browser flow. The host keeps the returned secret out of its renderer.
pub fn authorize(
    provider: Provider,
    transport: &dyn TokenTransport,
    open_external: impl FnOnce(&str) -> Result<(), Error>,
    is_cancelled: impl Fn() -> bool,
    timeout: Duration,
) -> Result<Credential, Error> {
    if is_cancelled() {
        return Err(Error::new("Browser OAuth authorization was cancelled."));
    }
    let config = Config::for_provider(provider);
    let verifier = pkce_verifier();
    let state = random_token();
    let listener = TcpListener::bind(("127.0.0.1", config.port()?))
        .map_err(|error| Error::new(format!("Cannot start OAuth callback: {error}")))?;
    listener
        .set_nonblocking(true)
        .map_err(|error| Error::new(format!("Cannot configure OAuth callback: {error}")))?;
    let url = authorization_url(provider, &config, &pkce_challenge(&verifier), &state)?;
    if is_cancelled() {
        return Err(Error::new("Browser OAuth authorization was cancelled."));
    }
    open_external(&url)?;
    let code = wait_for_callback(&listener, &config, &state, timeout, &is_cancelled)?;
    exchange_code(provider, &config, &code, &verifier, &state, transport)
}

/// Refreshes a credential. A refresh response without `refresh_token` retains the previous token.
pub fn refresh(
    provider: Provider,
    current: &Credential,
    transport: &dyn TokenTransport,
) -> Result<Credential, Error> {
    let config = Config::for_provider(provider);
    let client_id = config.client_id()?;
    let body = match provider {
        Provider::Anthropic => json!({"grant_type":"refresh_token","client_id":client_id,"refresh_token":current.refresh}).to_string(),
        Provider::OpenAi => form(&[("grant_type", "refresh_token"), ("client_id", &client_id), ("refresh_token", &current.refresh)]),
    };
    let content_type = if provider == Provider::Anthropic {
        "application/json"
    } else {
        "application/x-www-form-urlencoded"
    };
    let response = transport.send(TokenRequest {
        url: config.token_url.into(),
        content_type,
        body,
    })?;
    parse_token_response(provider, &response, Some(current), now_ms())
}

fn exchange_code(
    provider: Provider,
    config: &Config,
    code: &str,
    verifier: &str,
    state: &str,
    transport: &dyn TokenTransport,
) -> Result<Credential, Error> {
    let client_id = config.client_id()?;
    let body = match provider {
        Provider::Anthropic => json!({"grant_type":"authorization_code","client_id":client_id,"code":code,"state":state,"redirect_uri":config.redirect_uri,"code_verifier":verifier}).to_string(),
        Provider::OpenAi => form(&[("grant_type", "authorization_code"), ("client_id", &client_id), ("code", code), ("code_verifier", verifier), ("redirect_uri", config.redirect_uri)]),
    };
    let content_type = if provider == Provider::Anthropic {
        "application/json"
    } else {
        "application/x-www-form-urlencoded"
    };
    let response = transport.send(TokenRequest {
        url: config.token_url.into(),
        content_type,
        body,
    })?;
    parse_token_response(provider, &response, None, now_ms())
}

pub fn parse_token_response(
    provider: Provider,
    body: &str,
    previous: Option<&Credential>,
    now: i64,
) -> Result<Credential, Error> {
    let payload: Value = serde_json::from_str(body)
        .map_err(|_| Error::new("OAuth token response is not valid JSON."))?;
    let access = payload
        .get("access_token")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .trim()
        .to_owned();
    let refresh = payload
        .get("refresh_token")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_owned)
        .or_else(|| previous.map(|credential| credential.refresh.clone()))
        .unwrap_or_default();
    let expires_in = payload
        .get("expires_in")
        .and_then(Value::as_i64)
        .unwrap_or_default();
    if access.is_empty()
        || refresh.is_empty()
        || !(1..=MAX_TOKEN_LIFETIME_SECONDS).contains(&expires_in)
    {
        return Err(Error::new(
            "OAuth service did not return a complete renewable credential.",
        ));
    }
    let account_id = match provider {
        Provider::OpenAi => jwt_account_id(&access)
            .or_else(|| previous.and_then(|credential| credential.account_id.clone())),
        Provider::Anthropic => previous.and_then(|credential| credential.account_id.clone()),
    };
    if provider == Provider::OpenAi && account_id.is_none() {
        return Err(Error::new("OpenAI OAuth token has no ChatGPT account id."));
    }
    Ok(Credential {
        access,
        refresh,
        expires_at: now
            .saturating_add(expires_in.saturating_mul(1000))
            .saturating_sub(5 * 60_000),
        account_id,
    })
}

fn authorization_url(
    provider: Provider,
    config: &Config,
    challenge: &str,
    state: &str,
) -> Result<String, Error> {
    let mut url = Url::parse(config.authorize_url)
        .map_err(|_| Error::new("Invalid OAuth authorization URL."))?;
    {
        let mut pairs = url.query_pairs_mut();
        pairs
            .append_pair("response_type", "code")
            .append_pair("client_id", &config.client_id()?)
            .append_pair("redirect_uri", config.redirect_uri)
            .append_pair("scope", config.scope)
            .append_pair("code_challenge", challenge)
            .append_pair("code_challenge_method", "S256")
            .append_pair("state", state);
        match provider {
            Provider::Anthropic => {
                pairs.append_pair("code", "true");
            }
            Provider::OpenAi => {
                pairs
                    .append_pair("id_token_add_organizations", "true")
                    .append_pair("codex_cli_simplified_flow", "true")
                    .append_pair("originator", "pi");
            }
        }
    }
    Ok(url.into())
}

fn wait_for_callback(
    listener: &TcpListener,
    config: &Config,
    state: &str,
    timeout: Duration,
    is_cancelled: &dyn Fn() -> bool,
) -> Result<String, Error> {
    let deadline = Instant::now() + timeout;
    loop {
        if is_cancelled() {
            return Err(Error::new("Browser OAuth authorization was cancelled."));
        }
        if Instant::now() >= deadline {
            return Err(Error::new("Browser OAuth authorization timed out."));
        }
        match listener.accept() {
            Ok((stream, _)) => {
                if let Some(code) = read_callback(stream, config, state)? {
                    return Ok(code);
                }
            }
            Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                std::thread::sleep(Duration::from_millis(40))
            }
            Err(error) => return Err(Error::new(format!("OAuth callback failed: {error}"))),
        }
    }
}

fn read_callback(
    mut stream: TcpStream,
    config: &Config,
    state: &str,
) -> Result<Option<String>, Error> {
    stream
        .set_read_timeout(Some(Duration::from_secs(3)))
        .map_err(|error| Error::new(error.to_string()))?;
    let mut request = [0_u8; 16 * 1024];
    let read = stream
        .read(&mut request)
        .map_err(|error| Error::new(error.to_string()))?;
    let target = std::str::from_utf8(&request[..read])
        .ok()
        .and_then(|value| value.lines().next())
        .and_then(|line| line.split_whitespace().nth(1))
        .unwrap_or("/");
    let result = callback_code(target, config, state);
    let page = if result.is_some() {
        "Authorization received. Return to the application."
    } else {
        "Authorization was not completed. Return to the application."
    };
    let _ = stream.write_all(format!("HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{page}", page.len()).as_bytes());
    Ok(result)
}

fn callback_code(target: &str, config: &Config, state: &str) -> Option<String> {
    let url = Url::parse(&format!("http://localhost{target}")).ok()?;
    if url.path() != config.callback_path {
        return None;
    }
    let params = url
        .query_pairs()
        .collect::<std::collections::HashMap<_, _>>();
    (params.get("state").map(|value| value.as_ref()) == Some(state)
        && !params.contains_key("error"))
    .then(|| params.get("code").map(|value| value.trim().to_owned()))
    .flatten()
    .filter(|value| !value.is_empty())
}

fn form(values: &[(&str, &str)]) -> String {
    let mut url = Url::parse("http://localhost").expect("static URL");
    {
        let mut pairs = url.query_pairs_mut();
        for (key, value) in values {
            pairs.append_pair(key, value);
        }
    }
    url.query().unwrap_or_default().to_owned()
}
fn pkce_verifier() -> String {
    format!(
        "{}{}{}",
        Uuid::new_v4().simple(),
        Uuid::new_v4().simple(),
        Uuid::new_v4().simple()
    )
}
fn random_token() -> String {
    URL_SAFE_NO_PAD.encode(format!("{}{}", Uuid::new_v4(), Uuid::new_v4()))
}
fn pkce_challenge(verifier: &str) -> String {
    URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()))
}
fn jwt_account_id(access: &str) -> Option<String> {
    let payload = access.split('.').nth(1)?;
    let decoded = URL_SAFE_NO_PAD
        .decode(payload)
        .or_else(|_| URL_SAFE.decode(payload))
        .ok()?;
    serde_json::from_slice::<Value>(&decoded)
        .ok()?
        .get("https://api.openai.com/auth")?
        .get("chatgpt_account_id")?
        .as_str()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_owned)
}
fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
        .min(i64::MAX as u128) as i64
}
