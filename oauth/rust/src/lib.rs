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
use zeroize::{Zeroize, Zeroizing};

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
    pub timeout: Duration,
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

impl Drop for TokenRequest {
    fn drop(&mut self) {
        self.body.zeroize();
    }
}

pub trait TokenTransport: Send + Sync {
    fn send(&self, request: TokenRequest, is_cancelled: &dyn Fn() -> bool)
        -> Result<String, Error>;
}

pub struct UreqTransport;

impl TokenTransport for UreqTransport {
    fn send(
        &self,
        mut request: TokenRequest,
        is_cancelled: &dyn Fn() -> bool,
    ) -> Result<String, Error> {
        if is_cancelled() {
            return Err(Error::new("Browser OAuth authorization was cancelled."));
        }
        if request.timeout.is_zero() {
            return Err(Error::new("OAuth token request timed out."));
        }
        request.timeout = request.timeout.min(Duration::from_secs(30));
        let deadline = Instant::now() + request.timeout;
        let (sender, receiver) = std::sync::mpsc::sync_channel(1);
        std::thread::spawn(move || {
            let response = send_request(request).map(Zeroizing::new);
            let _ = sender.send(response);
        });
        loop {
            check_authorization(deadline, is_cancelled)?;
            match receiver.recv_timeout(Duration::from_millis(20)) {
                Ok(response) => return response.map(|body| body.to_string()),
                Err(std::sync::mpsc::RecvTimeoutError::Timeout) => {}
                Err(_) => return Err(Error::new("OAuth token request failed.")),
            }
        }
    }
}

fn send_request(request: TokenRequest) -> Result<String, Error> {
    let response = ureq::AgentBuilder::new()
        .timeout(request.timeout)
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
        .map_err(|_| Error::new("Cannot read OAuth token response."))?;
    if body.len() > RESPONSE_LIMIT {
        body.zeroize();
        return Err(Error::new("OAuth token response exceeds the size limit."));
    }
    Ok(body)
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
    if timeout.is_zero() || timeout > Duration::from_secs(600) {
        return Err(Error::new(
            "Authorization timeout must be within ten minutes.",
        ));
    }
    let deadline = Instant::now() + timeout;
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
    let code = wait_for_callback(&listener, &config, &state, deadline, &is_cancelled)?;
    check_authorization(deadline, &is_cancelled)?;
    drop(listener);
    let credential = exchange_code(
        provider,
        &config,
        &code,
        &verifier,
        &state,
        transport,
        deadline,
        &is_cancelled,
    )?;
    check_authorization(deadline, &is_cancelled)?;
    Ok(credential)
}

/// Refreshes a credential. A refresh response without `refresh_token` retains the previous token.
pub fn refresh(
    provider: Provider,
    current: &Credential,
    transport: &dyn TokenTransport,
) -> Result<Credential, Error> {
    if !valid_token(&current.refresh) {
        return Err(Error::new("OAuth refresh credential is invalid."));
    }
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
    let response = Zeroizing::new(transport.send(
        TokenRequest {
            url: config.token_url.into(),
            content_type,
            body,
            timeout: Duration::from_secs(30),
        },
        &|| false,
    )?);
    parse_token_response(provider, &response, Some(current), now_ms())
}

fn exchange_code(
    provider: Provider,
    config: &Config,
    code: &str,
    verifier: &str,
    state: &str,
    transport: &dyn TokenTransport,
    deadline: Instant,
    is_cancelled: &dyn Fn() -> bool,
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
    let response = Zeroizing::new(
        transport.send(
            TokenRequest {
                url: config.token_url.into(),
                content_type,
                body,
                timeout: deadline
                    .saturating_duration_since(Instant::now())
                    .min(Duration::from_secs(30)),
            },
            is_cancelled,
        )?,
    );
    parse_token_response(provider, &response, None, now_ms())
}

pub fn parse_token_response(
    provider: Provider,
    body: &str,
    previous: Option<&Credential>,
    now: i64,
) -> Result<Credential, Error> {
    if body.len() > RESPONSE_LIMIT {
        return Err(Error::new("OAuth token response exceeds the size limit."));
    }
    let mut payload: Value = serde_json::from_str(body)
        .map_err(|_| Error::new("OAuth token response is not valid JSON."))?;
    let access = payload
        .get_mut("access_token")
        .map(Value::take)
        .and_then(|v| {
            if let Value::String(s) = v {
                Some(s)
            } else {
                None
            }
        })
        .unwrap_or_default();
    let refresh = match payload.get_mut("refresh_token") {
        None => previous
            .map(|credential| credential.refresh.clone())
            .unwrap_or_default(),
        Some(value) => match value.take() {
            Value::String(s) => s,
            _ => String::new(),
        },
    };
    let expires_in = payload
        .get("expires_in")
        .and_then(Value::as_i64)
        .unwrap_or_default();
    if !valid_token(&access)
        || !valid_token(&refresh)
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
            .saturating_sub((expires_in * 100).min(5 * 60_000)),
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

fn check_authorization(deadline: Instant, is_cancelled: &dyn Fn() -> bool) -> Result<(), Error> {
    if is_cancelled() {
        return Err(Error::new("Browser OAuth authorization was cancelled."));
    }
    if Instant::now() >= deadline {
        return Err(Error::new("Browser OAuth authorization timed out."));
    }
    Ok(())
}

fn wait_for_callback(
    listener: &TcpListener,
    config: &Config,
    state: &str,
    deadline: Instant,
    is_cancelled: &dyn Fn() -> bool,
) -> Result<String, Error> {
    loop {
        check_authorization(deadline, is_cancelled)?;
        match listener.accept() {
            Ok((stream, _)) => {
                if let Some(code) = read_callback(stream, config, state, deadline, is_cancelled)? {
                    return Ok(code);
                }
            }
            Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                std::thread::sleep(Duration::from_millis(20))
            }
            Err(_) => return Err(Error::new("OAuth callback could not be read.")),
        }
    }
}

fn read_callback(
    mut stream: TcpStream,
    config: &Config,
    state: &str,
    deadline: Instant,
    is_cancelled: &dyn Fn() -> bool,
) -> Result<Option<String>, Error> {
    stream
        .set_read_timeout(Some(Duration::from_millis(40)))
        .map_err(|_| Error::new("Cannot configure OAuth callback."))?;
    stream
        .set_write_timeout(Some(Duration::from_millis(200)))
        .map_err(|_| Error::new("Cannot configure OAuth callback."))?;
    let mut request = Vec::new();
    let request_deadline = deadline.min(Instant::now() + Duration::from_secs(3));
    loop {
        check_authorization(deadline, is_cancelled)?;
        if Instant::now() >= request_deadline {
            return Ok(None);
        }
        let mut chunk = [0_u8; 1024];
        match stream.read(&mut chunk) {
            Ok(0) => return Ok(None),
            Ok(count) => request.extend_from_slice(&chunk[..count]),
            Err(error)
                if matches!(
                    error.kind(),
                    std::io::ErrorKind::WouldBlock | std::io::ErrorKind::TimedOut
                ) =>
            {
                continue
            }
            Err(_) => return Ok(None),
        }
        if request.len() > 16 * 1024 {
            write_callback(&mut stream, 400);
            return Ok(None);
        }
        if request.windows(4).any(|part| part == b"\r\n\r\n") {
            break;
        }
    }
    let Some(code) = callback_code(&request, config, state) else {
        write_callback(&mut stream, 400);
        return Ok(None);
    };
    match code {
        Ok(code) => {
            write_callback(&mut stream, 200);
            Ok(Some(code))
        }
        Err(()) => {
            write_callback(&mut stream, 400);
            Err(Error::new("Browser OAuth authorization was denied."))
        }
    }
}

fn write_callback(stream: &mut TcpStream, status: u16) {
    let (reason, page) = if status == 200 {
        ("OK", "Authorization received. Return to the application.")
    } else {
        (
            "Bad Request",
            "Authorization was not completed. Return to the application.",
        )
    };
    let _ = stream.write_all(format!("HTTP/1.1 {status} {reason}\r\nContent-Type: text/plain\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{page}", page.len()).as_bytes());
}

fn callback_code(request: &[u8], config: &Config, state: &str) -> Option<Result<String, ()>> {
    let text = std::str::from_utf8(request).ok()?;
    let mut lines = text.split("\r\n");
    let parts: Vec<_> = lines.next()?.split_whitespace().collect();
    if parts.len() != 3
        || parts[0] != "GET"
        || !matches!(parts[2], "HTTP/1.1" | "HTTP/1.0")
        || !parts[1].starts_with('/')
        || parts[1].starts_with("//")
    {
        return None;
    }
    let hosts: Vec<_> = lines
        .take_while(|line| !line.is_empty())
        .filter_map(|line| line.split_once(':'))
        .filter(|(name, _)| name.eq_ignore_ascii_case("host"))
        .map(|(_, value)| value.trim())
        .collect();
    let port = config.port().ok()?;
    if hosts.len() != 1
        || (hosts[0] != format!("localhost:{port}") && hosts[0] != format!("127.0.0.1:{port}"))
    {
        return None;
    }
    let url = Url::parse(&format!("http://localhost{}", parts[1])).ok()?;
    if url.path() != config.callback_path || url.fragment().is_some() {
        return None;
    }
    let params: Vec<_> = url.query_pairs().collect();
    let values = |name: &str| {
        params
            .iter()
            .filter(|(key, _)| key == name)
            .map(|(_, value)| value.as_ref())
            .collect::<Vec<_>>()
    };
    let states = values("state");
    if states.len() != 1 || states[0] != state {
        return None;
    }
    let errors = values("error");
    if !errors.is_empty() {
        return Some(Err(()));
    }
    let codes = values("code");
    if codes.len() != 1 || !valid_token(codes[0]) {
        return None;
    }
    Some(Ok(codes[0].to_owned()))
}

fn valid_token(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 32768
        && value
            .bytes()
            .all(|byte| !byte.is_ascii_whitespace() && !byte.is_ascii_control())
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
