use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use model_auth_native::{authorize, parse_token_response, refresh, Credential, Error, Provider, TokenRequest, TokenTransport};
use std::time::Duration;

struct Fixture { response: String }
impl TokenTransport for Fixture { fn send(&self, _: TokenRequest) -> Result<String, Error> { Ok(self.response.clone()) } }

fn openai_jwt(account: &str) -> String {
    let payload = format!(r#"{{"https://api.openai.com/auth":{{"chatgpt_account_id":"{account}"}}}}"#);
    format!("x.{}.x", URL_SAFE_NO_PAD.encode(payload))
}

#[test]
fn openai_refresh_preserves_rotated_secret_and_account() {
    let current = Credential { access: String::new(), refresh: "old-refresh".into(), expires_at: 0, account_id: Some("acct".into()) };
    let response = format!(r#"{{"access_token":"{}","expires_in":3600}}"#, openai_jwt("acct"));
    let refreshed = refresh(Provider::OpenAi, &current, &Fixture { response }).unwrap();
    assert_eq!(refreshed.refresh, "old-refresh");
    assert_eq!(refreshed.account_id.as_deref(), Some("acct"));
}

#[test]
fn anthropic_refresh_accepts_a_rotated_secret() {
    let current = Credential { access: String::new(), refresh: "old".into(), expires_at: 0, account_id: None };
    let refreshed = refresh(Provider::Anthropic, &current, &Fixture { response: r#"{"access_token":"new-access","refresh_token":"new-refresh","expires_in":1800}"#.into() }).unwrap();
    assert_eq!(refreshed.refresh, "new-refresh");
}

#[test]
fn openai_requires_an_account_id() {
    let error = parse_token_response(Provider::OpenAi, r#"{"access_token":"not-a-jwt","refresh_token":"refresh","expires_in":1}"#, None, 0).unwrap_err();
    assert!(error.to_string().contains("account id"));
}

#[test]
fn debug_output_never_discloses_credentials() {
    let credential = Credential { access: "access-secret".into(), refresh: "refresh-secret".into(), expires_at: 0, account_id: Some("account".into()) };
    let request = TokenRequest { url: "https://example.invalid".into(), content_type: "application/json", body: "refresh_token=secret".into() };
    assert!(!format!("{credential:?}").contains("access-secret"));
    assert!(!format!("{credential:?}").contains("refresh-secret"));
    assert!(!format!("{request:?}").contains("refresh_token=secret"));
}

#[test]
fn authorization_stops_before_opening_a_browser_when_cancelled() {
    let result = authorize(
        Provider::OpenAi,
        &Fixture { response: String::new() },
        |_| panic!("cancelled authorization must not open a browser"),
        || true,
        Duration::from_secs(1),
    );
    assert!(result.unwrap_err().to_string().contains("cancelled"));
}
