use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use model_auth_native::{
    authorize, parse_token_response, refresh, Credential, Error, Provider, TokenRequest,
    TokenTransport,
};
use std::time::Duration;

struct Fixture {
    response: String,
}
impl TokenTransport for Fixture {
    fn send(&self, _: TokenRequest, _: &dyn Fn() -> bool) -> Result<String, Error> {
        Ok(self.response.clone())
    }
}

fn openai_jwt(account: &str) -> String {
    let payload =
        format!(r#"{{"https://api.openai.com/auth":{{"chatgpt_account_id":"{account}"}}}}"#);
    format!("x.{}.x", URL_SAFE_NO_PAD.encode(payload))
}

#[test]
fn openai_refresh_preserves_rotated_secret_and_account() {
    let current = Credential {
        access: String::new(),
        refresh: "old-refresh".into(),
        expires_at: 0,
        account_id: Some("acct".into()),
    };
    let response = format!(
        r#"{{"access_token":"{}","expires_in":3600}}"#,
        openai_jwt("acct")
    );
    let refreshed = refresh(Provider::OpenAi, &current, &Fixture { response }).unwrap();
    assert_eq!(refreshed.refresh, "old-refresh");
    assert_eq!(refreshed.account_id.as_deref(), Some("acct"));
}

#[test]
fn anthropic_refresh_accepts_a_rotated_secret() {
    let current = Credential {
        access: String::new(),
        refresh: "old".into(),
        expires_at: 0,
        account_id: None,
    };
    let refreshed = refresh(
        Provider::Anthropic,
        &current,
        &Fixture {
            response:
                r#"{"access_token":"new-access","refresh_token":"new-refresh","expires_in":1800}"#
                    .into(),
        },
    )
    .unwrap();
    assert_eq!(refreshed.refresh, "new-refresh");
}

#[test]
fn openai_requires_an_account_id() {
    let error = parse_token_response(
        Provider::OpenAi,
        r#"{"access_token":"not-a-jwt","refresh_token":"refresh","expires_in":1}"#,
        None,
        0,
    )
    .unwrap_err();
    assert!(error.to_string().contains("account id"));
}

#[test]
fn debug_output_never_discloses_credentials() {
    let credential = Credential {
        access: "access-secret".into(),
        refresh: "refresh-secret".into(),
        expires_at: 0,
        account_id: Some("account".into()),
    };
    let request = TokenRequest {
        url: "https://example.invalid".into(),
        content_type: "application/json",
        body: "refresh_token=secret".into(),
        timeout: Duration::from_secs(30),
    };
    assert!(!format!("{credential:?}").contains("access-secret"));
    assert!(!format!("{credential:?}").contains("refresh-secret"));
    assert!(!format!("{request:?}").contains("refresh_token=secret"));
}

#[test]
fn authorization_stops_before_opening_a_browser_when_cancelled() {
    let result = authorize(
        Provider::OpenAi,
        &Fixture {
            response: String::new(),
        },
        |_| panic!("cancelled authorization must not open a browser"),
        || true,
        Duration::from_secs(1),
    );
    assert!(result.unwrap_err().to_string().contains("cancelled"));
}

use sha2::{Digest, Sha256};
use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc, Mutex,
};
use url::Url;

static AUTHORIZATION: Mutex<()> = Mutex::new(());
struct InspectTransport {
    response: String,
    requests: Mutex<Vec<(String, String, String)>>,
}
impl TokenTransport for InspectTransport {
    fn send(&self, request: TokenRequest, _: &dyn Fn() -> bool) -> Result<String, Error> {
        self.requests.lock().unwrap().push((
            request.url.clone(),
            request.content_type.into(),
            request.body.clone(),
        ));
        Ok(self.response.clone())
    }
}
fn callback_request(port: u16, request: &str, fragmented: bool) -> String {
    let mut stream = TcpStream::connect(("127.0.0.1", port)).unwrap();
    stream
        .set_read_timeout(Some(Duration::from_secs(2)))
        .unwrap();
    if fragmented {
        let midpoint = request.len() / 2;
        stream.write_all(&request.as_bytes()[..midpoint]).unwrap();
        std::thread::sleep(Duration::from_millis(15));
        stream.write_all(&request.as_bytes()[midpoint..]).unwrap();
    } else {
        stream.write_all(request.as_bytes()).unwrap();
    }
    let mut response = String::new();
    stream.read_to_string(&mut response).unwrap();
    response
}

#[test]
fn both_browser_flows_exchange_correlated_codes_after_fragmented_callbacks() {
    let _guard = AUTHORIZATION.lock().unwrap();
    for provider in [Provider::OpenAi, Provider::Anthropic] {
        let transport = InspectTransport {
            response: format!(
                r#"{{"access_token":"{}","refresh_token":"renewable","expires_in":120}}"#,
                openai_jwt("account")
            ),
            requests: Mutex::new(Vec::new()),
        };
        let opened = Mutex::new(None);
        let browser = Mutex::new(None);
        let credential = authorize(
            provider,
            &transport,
            |value| {
                let url = Url::parse(value).unwrap();
                let params: std::collections::HashMap<_, _> =
                    url.query_pairs().into_owned().collect();
                let redirect = Url::parse(&params["redirect_uri"]).unwrap();
                let port = redirect.port().unwrap();
                assert_eq!(
                    port,
                    if provider == Provider::OpenAi {
                        1455
                    } else {
                        53692
                    }
                );
                let target = format!(
                    "{}?code=wire-code&state={}",
                    redirect.path(),
                    params["state"]
                );
                *opened.lock().unwrap() = Some(params);
                *browser.lock().unwrap() = Some(std::thread::spawn(move || {
                    let response = callback_request(
                        port,
                        &format!("GET {target} HTTP/1.1\r\nHost: localhost:{port}\r\n\r\n"),
                        true,
                    );
                    assert!(response.starts_with("HTTP/1.1 200"));
                }));
                Ok(())
            },
            || false,
            Duration::from_secs(2),
        )
        .unwrap();
        browser.into_inner().unwrap().unwrap().join().unwrap();
        let params = opened.into_inner().unwrap().unwrap();
        let requests = transport.requests.lock().unwrap();
        assert_eq!(requests.len(), 1);
        let (_, content_type, body) = &requests[0];
        let fields: std::collections::HashMap<String, String> = if provider == Provider::OpenAi {
            assert_eq!(content_type, "application/x-www-form-urlencoded");
            url::form_urlencoded::parse(body.as_bytes())
                .into_owned()
                .collect()
        } else {
            assert_eq!(content_type, "application/json");
            serde_json::from_str(body).unwrap()
        };
        assert_eq!(fields["code"], "wire-code");
        assert_eq!(
            URL_SAFE_NO_PAD.encode(Sha256::digest(fields["code_verifier"].as_bytes())),
            params["code_challenge"]
        );
        if provider == Provider::Anthropic {
            assert_eq!(fields["state"], params["state"]);
        }
        assert!(
            credential.expires_at
                > std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .unwrap()
                    .as_millis() as i64
        );
        TcpListener::bind((
            "127.0.0.1",
            if provider == Provider::OpenAi {
                1455
            } else {
                53692
            },
        ))
        .unwrap();
    }
}

#[test]
fn callback_rejects_wrong_method_host_state_and_duplicate_codes() {
    let _guard = AUTHORIZATION.lock().unwrap();
    let browser = Mutex::new(None);
    authorize(Provider::Anthropic, &Fixture { response: r#"{"access_token":"access","refresh_token":"refresh","expires_in":3600}"#.into() }, |value| {
        let url = Url::parse(value).unwrap();
        let state = url.query_pairs().find(|(k, _)| k == "state").unwrap().1.into_owned();
        *browser.lock().unwrap() = Some(std::thread::spawn(move || {
            let port = 53692;
            for (method, host, query) in [
                ("POST", "localhost:53692", format!("code=code&state={state}")),
                ("GET", "untrusted.test", format!("code=code&state={state}")),
                ("GET", "localhost:53692", "code=code&state=wrong".into()),
                ("GET", "localhost:53692", format!("code=code&state={state}&state={state}")),
                ("GET", "localhost:53692", format!("code=code&code=second&state={state}")),
            ] {
                let response = callback_request(port, &format!("{method} /callback?{query} HTTP/1.1\r\nHost: {host}\r\n\r\n"), false);
                assert!(response.starts_with("HTTP/1.1 400"));
            }
            assert!(callback_request(port, &format!("GET /callback?code=accepted&state={state} HTTP/1.1\r\nHost: localhost:{port}\r\n\r\n"), false).starts_with("HTTP/1.1 200"));
        }));
        Ok(())
    }, || false, Duration::from_secs(2)).unwrap();
    browser.into_inner().unwrap().unwrap().join().unwrap();
}

#[test]
fn browser_failure_timeout_denial_and_partial_request_cancellation_release_port() {
    let _guard = AUTHORIZATION.lock().unwrap();
    let transport = Fixture {
        response: String::new(),
    };
    assert!(authorize(
        Provider::OpenAi,
        &transport,
        |_| Err(Error::new("browser unavailable")),
        || false,
        Duration::from_secs(1)
    )
    .is_err());
    assert!(authorize(
        Provider::OpenAi,
        &transport,
        |_| Ok(()),
        || false,
        Duration::from_millis(50)
    )
    .unwrap_err()
    .to_string()
    .contains("timed out"));
    let browser = Mutex::new(None);
    assert!(authorize(Provider::OpenAi, &transport, |value| {
        let url = Url::parse(value).unwrap();
        let state = url.query_pairs().find(|(k, _)| k == "state").unwrap().1.into_owned();
        *browser.lock().unwrap() = Some(std::thread::spawn(move || {
            assert!(callback_request(1455, &format!("GET /auth/callback?error=access_denied&state={state} HTTP/1.1\r\nHost: localhost:1455\r\n\r\n"), false).starts_with("HTTP/1.1 400"));
        })); Ok(())
    }, || false, Duration::from_secs(1)).unwrap_err().to_string().contains("denied"));
    browser.into_inner().unwrap().unwrap().join().unwrap();
    let cancelled = Arc::new(AtomicBool::new(false));
    let browser = Mutex::new(None);
    assert!(authorize(
        Provider::OpenAi,
        &transport,
        |_| {
            let cancelled = cancelled.clone();
            *browser.lock().unwrap() = Some(std::thread::spawn(move || {
                let mut stream = TcpStream::connect(("127.0.0.1", 1455)).unwrap();
                stream
                    .write_all(b"GET /auth/callback HTTP/1.1\r\n")
                    .unwrap();
                std::thread::sleep(Duration::from_millis(30));
                cancelled.store(true, Ordering::SeqCst);
            }));
            Ok(())
        },
        || cancelled.load(Ordering::SeqCst),
        Duration::from_secs(1)
    )
    .unwrap_err()
    .to_string()
    .contains("cancelled"));
    browser.into_inner().unwrap().unwrap().join().unwrap();
    let listener = TcpListener::bind(("127.0.0.1", 1455)).unwrap();
    assert!(authorize(
        Provider::OpenAi,
        &transport,
        |_| panic!("occupied port must not open browser"),
        || false,
        Duration::from_secs(1)
    )
    .is_err());
    drop(listener);
}

#[test]
fn malformed_rotated_tokens_are_rejected_and_short_lifetimes_stay_usable() {
    let previous = Credential {
        access: "a".into(),
        refresh: "old".into(),
        expires_at: 0,
        account_id: None,
    };
    for token in [r#"""#, "null", "123", r#""contains space""#] {
        let body = format!(r#"{{"access_token":"new","refresh_token":{token},"expires_in":120}}"#);
        assert!(parse_token_response(Provider::Anthropic, &body, Some(&previous), 1000).is_err());
    }
    let next = parse_token_response(
        Provider::Anthropic,
        r#"{"access_token":"a","refresh_token":"r","expires_in":120}"#,
        None,
        1000,
    )
    .unwrap();
    assert!(next.expires_at > 1000);
}
