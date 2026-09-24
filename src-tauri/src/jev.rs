//! Calls to Jev, TypeSafe's decision model (SPEC §9.5).
//!
//! Jev answers typed questions about a `state`. It writes no text. The
//! frontend builds the questions and reads the answers (SPEC §8.4); this
//! module only makes the request, as Rust makes every network call. `genai`
//! has no adapter for this API, because it is not a chat API, so `reqwest`
//! makes the request.
//!
//! Rust does not read the questions or the answers. It sends the questions
//! as the frontend built them, and returns the `answers` object as JSON with
//! the token counts, the cost and the version of the model that answered.

use std::sync::OnceLock;
use std::time::Duration;

use serde::Serialize;
use serde_json::Value;

use crate::config::Provider;
use crate::error::{AppError, AppResult, CallError};
use crate::llm::vendor;
use crate::prices::{self, Tokens};
use crate::{log, secrets};

/// TypeSafe's API. `base_url` in `config.toml` replaces it.
pub const DEFAULT_BASE: &str = "https://api.typesafe.ai/v1";

/// Attempts in all, for a reply of 429 or 529.
const ATTEMPTS: usize = 4;

/// The waits between attempts, when the reply has no `retry-after`.
const BACKOFF: [Duration; ATTEMPTS - 1] = [
    Duration::from_millis(500),
    Duration::from_millis(1000),
    Duration::from_millis(2000),
];

/// How much of an error body goes into a message.
const BODY_START: usize = 300;

/// One reply. `answers` is `null` when the body was not JSON or held no
/// `answers`; `unreadable` then says why, and the frontend counts the reply
/// as unreadable (SPEC §8.4). `tokens` is `None` when the reply gave no
/// usage, and `cost_usd` is `None` when no price is known (SPEC §9.4).
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct JevReply {
    pub answers: Value,
    pub tokens: Option<Tokens>,
    pub cost_usd: Option<f64>,
    /// The version that answered, from the reply's `model` field.
    pub model: Option<String>,
    pub unreadable: Option<String>,
}

/// The address of the request: `{base}/systemone`.
pub fn endpoint(provider: &Provider) -> String {
    let base = provider.base_url.as_deref().unwrap_or(DEFAULT_BASE);
    format!("{}/systemone", base.trim_end_matches('/'))
}

/// The request body.
pub fn body(model: &str, state: &Value, questions: &Value) -> Value {
    serde_json::json!({ "state": state, "model": model, "questions": questions })
}

/// One client for every call, so the connections are reused.
fn client() -> &'static reqwest::Client {
    static CLIENT: OnceLock<reqwest::Client> = OnceLock::new();
    CLIENT.get_or_init(reqwest::Client::new)
}

/// The start of a body, cut on a character boundary.
fn start_of(text: &str) -> String {
    text.chars().take(BODY_START).collect()
}

/// The wait a `retry-after` header asks for, in seconds. A date is not
/// read; the backoff applies then.
fn retry_after(headers: &reqwest::header::HeaderMap) -> Option<Duration> {
    let value = headers.get(reqwest::header::RETRY_AFTER)?.to_str().ok()?;
    let secs: f64 = value.trim().parse().ok()?;
    (secs.is_finite() && secs >= 0.0).then(|| Duration::from_secs_f64(secs))
}

/// Send the request, and send it again after a 429 or a 529, up to four
/// attempts in all. Returns the body of the first reply that is neither.
/// Any other HTTP error fails at once, with its status and the start of its
/// body. A 401 or 403 says TypeSafe refused the key, which every request of
/// the pass would share (SPEC §8.4).
async fn send(url: &str, key: &str, request: &Value) -> AppResult<String> {
    let mut waits = BACKOFF.iter();
    loop {
        let reply = client()
            .post(url)
            .bearer_auth(key)
            .json(request)
            .send()
            .await
            .map_err(|e| AppError::other(format!("jev: {e}")))?;
        let status = reply.status();
        let busy = status.as_u16() == 429 || status.as_u16() == 529;
        if busy {
            if let Some(backoff) = waits.next() {
                let wait = retry_after(reply.headers()).unwrap_or(*backoff);
                tokio::time::sleep(wait).await;
                continue;
            }
        }
        let text = reply
            .text()
            .await
            .map_err(|e| AppError::other(format!("jev: {e}")))?;
        if busy {
            return Err(AppError::other(format!(
                "jev: HTTP {status} after {ATTEMPTS} attempts: {}",
                start_of(&text)
            )));
        }
        if !status.is_success() {
            let message = format!("jev: HTTP {status}: {}", start_of(&text));
            return Err(if matches!(status.as_u16(), 401 | 403) {
                AppError::Refused(message)
            } else {
                AppError::other(message)
            });
        }
        return Ok(text);
    }
}

/// Read a reply body into the parts the frontend needs, without reading the
/// answers. `name` and `provider` price the call.
fn reply_from(name: &str, provider: &Provider, model: &str, text: &str) -> AppResult<JevReply> {
    let Ok(json) = serde_json::from_str::<Value>(text) else {
        return Ok(JevReply {
            answers: Value::Null,
            tokens: None,
            cost_usd: None,
            model: None,
            unreadable: Some(format!(
                "jev returned a body that is not JSON: {}",
                start_of(text)
            )),
        });
    };
    if let Some(error) = json.get("error").filter(|e| !e.is_null()) {
        return Err(AppError::other(format!(
            "jev: {}",
            start_of(&error.to_string())
        )));
    }

    let usage = json.get("usage");
    let count = |k: &str| usage.and_then(|u| u.get(k)).and_then(Value::as_u64);
    let tokens = match (count("input_tokens"), count("output_tokens")) {
        (None, None) => None,
        (input, output) => Some(Tokens {
            input: input.unwrap_or(0),
            output: output.unwrap_or(0),
            cache_read: 0,
            cache_write: 0,
        }),
    };
    let cost_usd = tokens.and_then(|t| {
        prices::rates_for(vendor(name, provider), model, provider.price.as_ref())
            .map(|rates| prices::cost(&rates, &t))
    });

    let answers = json.get("answers").cloned().unwrap_or(Value::Null);
    let unreadable = (!answers.is_object()).then(|| "jev returned no answers".to_string());
    Ok(JevReply {
        answers,
        tokens,
        cost_usd,
        model: json
            .get("model")
            .and_then(Value::as_str)
            .map(str::to_string),
        unreadable,
    })
}

/// Ask Jev the questions about `state`. `name` is the provider's table name
/// in `config.toml`, used to find its price. A missing model or key is
/// reported before any request.
pub async fn ask(
    name: &str,
    provider: &Provider,
    state: &Value,
    questions: &Value,
) -> AppResult<JevReply> {
    if provider.kind != "jev" {
        return Err(AppError::invalid(format!(
            "provider '{name}' is kind '{}', not jev",
            provider.kind
        )));
    }
    let model = provider.model.clone().ok_or_else(|| {
        AppError::invalid(
            "this provider names no model in config.toml; use a version such as jev-1.13.0",
        )
    })?;
    let key = secrets::resolve_key(provider.key_ref.as_deref())?.ok_or_else(|| {
        AppError::invalid(
            "no key for this provider. Set key_ref in config.toml to env:NAME or \
             keychain:service/account, and put the value in the keychain or in \
             ~/.writegood/.env",
        )
    })?;

    let url = endpoint(provider);
    let request = body(&model, state, questions);
    // Every attempt and every wait fall inside the one ceiling.
    let seconds = provider.timeout_secs.max(1);
    let text = tokio::time::timeout(Duration::from_secs(seconds), send(&url, &key, &request))
        .await
        .map_err(|_| AppError::other(format!("{model} did not answer within {seconds}s")))??;

    let reply = reply_from(name, provider, &model, &text)?;
    let _ = log::write(
        "info",
        &format!(
            "jev: {name} answered with {}",
            reply.model.as_deref().unwrap_or("no model name")
        ),
    );
    Ok(reply)
}

/// A failed request rejects with a `CallError`, whose `wholePass` marks a
/// failure every request of the pass would share: a refused key, a missing
/// key or model, or a bad config (SPEC §8.4).
#[tauri::command]
pub async fn jev_ask(
    name: String,
    provider: Provider,
    state: Value,
    questions: Value,
) -> Result<JevReply, CallError> {
    Ok(ask(&name, &provider, &state, &questions).await?)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::prices::Rates;
    use std::io::{BufRead, BufReader, Read, Write};
    use std::net::TcpListener;
    use std::sync::{Arc, Mutex};

    /// One request the fake server saw.
    #[derive(Debug, Clone)]
    struct Seen {
        line: String,
        headers: Vec<(String, String)>,
        body: Value,
    }

    /// Each response: status, extra headers, body.
    type Script = Vec<(u16, Vec<(&'static str, &'static str)>, String)>;

    /// A fake Jev on 127.0.0.1. It answers each request with the next
    /// response in `script`, and repeats the last one when the script ends.
    /// Each response is (status, extra headers, body).
    fn fake(script: Script) -> (String, Arc<Mutex<Vec<Seen>>>) {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let base = format!("http://{}/v1", listener.local_addr().unwrap());
        let seen = Arc::new(Mutex::new(Vec::new()));
        let log = seen.clone();
        std::thread::spawn(move || {
            for (n, stream) in listener.incoming().enumerate() {
                let Ok(mut stream) = stream else { return };
                let mut reader = BufReader::new(stream.try_clone().unwrap());
                let mut line = String::new();
                reader.read_line(&mut line).unwrap();
                let mut headers = Vec::new();
                let mut length = 0;
                loop {
                    let mut h = String::new();
                    reader.read_line(&mut h).unwrap();
                    let h = h.trim_end();
                    if h.is_empty() {
                        break;
                    }
                    let (k, v) = h.split_once(':').unwrap();
                    let (k, v) = (k.trim().to_lowercase(), v.trim().to_string());
                    if k == "content-length" {
                        length = v.parse().unwrap();
                    }
                    headers.push((k, v));
                }
                let mut raw = vec![0; length];
                reader.read_exact(&mut raw).unwrap();
                log.lock().unwrap().push(Seen {
                    line: line.trim_end().to_string(),
                    headers,
                    body: serde_json::from_slice(&raw).unwrap_or(Value::Null),
                });
                let (status, extra, body) = &script[n.min(script.len() - 1)];
                let mut head = format!(
                    "HTTP/1.1 {status} X\r\ncontent-type: application/json\r\ncontent-length: {}\r\nconnection: close\r\n",
                    body.len()
                );
                for (k, v) in extra {
                    head.push_str(&format!("{k}: {v}\r\n"));
                }
                head.push_str("\r\n");
                let _ = stream.write_all(head.as_bytes());
                let _ = stream.write_all(body.as_bytes());
            }
        });
        (base, seen)
    }

    fn provider(base: &str) -> Provider {
        std::env::set_var("WRITEGOOD_JEV_TEST_KEY", "test-key");
        Provider {
            kind: "jev".into(),
            model: Some("jev-1.13.0".into()),
            base_url: Some(base.into()),
            key_ref: Some("env:WRITEGOOD_JEV_TEST_KEY".into()),
            timeout_secs: 20,
            // No catalog lists this vendor, so the config price applies.
            catalog: Some("writegood-test-no-such-vendor".into()),
            price: Some(Rates {
                input: 0.042,
                output: 0.0,
                cache_read: None,
                cache_write: None,
            }),
            ..Provider::default()
        }
    }

    const OK: &str = r#"{"model":"jev-1.13.0","answers":{"q0":{"type":"noul","noul":0.9}},"usage":{"input_tokens":1000000,"output_tokens":20}}"#;

    fn questions() -> Value {
        serde_json::json!({ "q0": { "type": "noul", "instructions": "Is it?" } })
    }

    #[tokio::test]
    async fn the_request_has_the_documented_shape() {
        let _home = crate::config::testing::env_home("jev-shape");
        let (base, seen) = fake(vec![(200, vec![], OK.into())]);
        let reply = ask(
            "jev",
            &provider(&base),
            &Value::String("A paragraph.".into()),
            &questions(),
        )
        .await
        .unwrap();

        let seen = seen.lock().unwrap().clone();
        assert_eq!(seen.len(), 1);
        assert_eq!(seen[0].line, "POST /v1/systemone HTTP/1.1");
        assert!(seen[0]
            .headers
            .contains(&("authorization".into(), "Bearer test-key".into())));
        assert_eq!(
            seen[0].body,
            serde_json::json!({ "state": "A paragraph.", "model": "jev-1.13.0", "questions": questions() })
        );

        assert_eq!(reply.answers["q0"]["noul"], 0.9);
        assert_eq!(reply.model.as_deref(), Some("jev-1.13.0"));
        assert_eq!(reply.unreadable, None);
        let tokens = reply.tokens.unwrap();
        assert_eq!((tokens.input, tokens.output), (1_000_000, 20));
        // A million input tokens at the config price; output is free.
        assert!((reply.cost_usd.unwrap() - 0.042).abs() < 1e-12);
    }

    #[tokio::test]
    async fn a_429_is_asked_again_and_the_next_reply_counts() {
        let _home = crate::config::testing::env_home("jev-retry");
        let (base, seen) = fake(vec![
            (
                429,
                vec![("retry-after", "0")],
                "{\"error\":\"slow down\"}".into(),
            ),
            (529, vec![("retry-after", "0")], "{}".into()),
            (200, vec![], OK.into()),
        ]);
        let reply = ask("jev", &provider(&base), &Value::Null, &questions())
            .await
            .unwrap();
        assert_eq!(seen.lock().unwrap().len(), 3);
        assert_eq!(reply.answers["q0"]["type"], "noul");
    }

    #[tokio::test]
    async fn four_busy_replies_fail_the_call() {
        let _home = crate::config::testing::env_home("jev-busy");
        let (base, seen) = fake(vec![(
            429,
            vec![("retry-after", "0")],
            "{\"error\":\"slow down\"}".into(),
        )]);
        let err = ask("jev", &provider(&base), &Value::Null, &questions())
            .await
            .unwrap_err()
            .to_string();
        assert_eq!(seen.lock().unwrap().len(), 4);
        assert!(err.contains("429"), "{err}");
        assert!(err.contains("4 attempts"), "{err}");
    }

    #[tokio::test]
    async fn without_retry_after_the_backoff_applies() {
        let _home = crate::config::testing::env_home("jev-backoff");
        let (base, seen) = fake(vec![(529, vec![], "{}".into()), (200, vec![], OK.into())]);
        let started = std::time::Instant::now();
        ask("jev", &provider(&base), &Value::Null, &questions())
            .await
            .unwrap();
        assert_eq!(seen.lock().unwrap().len(), 2);
        assert!(started.elapsed() >= Duration::from_millis(500));
    }

    #[tokio::test]
    async fn another_http_error_fails_at_once_with_the_status_and_body() {
        let _home = crate::config::testing::env_home("jev-422");
        let (base, seen) = fake(vec![(
            422,
            vec![],
            "{\"detail\":\"questions.q0.type\"}".into(),
        )]);
        let err = ask("jev", &provider(&base), &Value::Null, &questions())
            .await
            .unwrap_err()
            .to_string();
        assert_eq!(seen.lock().unwrap().len(), 1);
        assert!(err.contains("422"), "{err}");
        assert!(err.contains("questions.q0.type"), "{err}");
    }

    #[tokio::test]
    async fn a_refused_key_fails_every_request_at_once() {
        let _home = crate::config::testing::env_home("jev-401");
        for status in [401, 403] {
            let (base, seen) = fake(vec![(status, vec![], "{\"detail\":\"bad key\"}".into())]);
            let err = jev_ask("jev".into(), provider(&base), Value::Null, questions())
                .await
                .unwrap_err();
            assert_eq!(seen.lock().unwrap().len(), 1, "{status}");
            assert!(err.whole_pass, "{status}: {}", err.message);
            assert!(err.message.contains(&status.to_string()), "{}", err.message);
        }
    }

    #[tokio::test]
    async fn another_failure_fails_only_its_request() {
        let _home = crate::config::testing::env_home("jev-500");
        let (base, _) = fake(vec![(500, vec![], "{}".into())]);
        let err = jev_ask("jev".into(), provider(&base), Value::Null, questions())
            .await
            .unwrap_err();
        assert!(!err.whole_pass, "{}", err.message);
    }

    #[tokio::test]
    async fn a_missing_key_or_model_fails_every_request() {
        let mut p = provider("http://127.0.0.1:1/v1");
        p.key_ref = Some("env:WRITEGOOD_KEY_THAT_IS_NOT_SET".into());
        let err = jev_ask("jev".into(), p, Value::Null, questions())
            .await
            .unwrap_err();
        assert!(err.whole_pass, "{}", err.message);
        let mut p = provider("http://127.0.0.1:1/v1");
        p.model = None;
        let err = jev_ask("jev".into(), p, Value::Null, questions())
            .await
            .unwrap_err();
        assert!(err.whole_pass, "{}", err.message);
    }

    #[tokio::test]
    async fn a_body_that_is_not_json_is_unreadable_not_a_failure() {
        let _home = crate::config::testing::env_home("jev-notjson");
        let (base, _) = fake(vec![(200, vec![], "<html>gateway</html>".into())]);
        let reply = ask("jev", &provider(&base), &Value::Null, &questions())
            .await
            .unwrap();
        assert!(reply.answers.is_null());
        assert!(reply.unreadable.unwrap().contains("not JSON"));
    }

    #[tokio::test]
    async fn a_missing_key_is_reported_before_any_request() {
        let mut p = provider("http://127.0.0.1:1/v1");
        p.key_ref = Some("env:WRITEGOOD_KEY_THAT_IS_NOT_SET".into());
        let err = ask("jev", &p, &Value::Null, &questions())
            .await
            .unwrap_err()
            .to_string();
        assert!(err.contains("no key"), "{err}");
    }

    #[tokio::test]
    async fn a_missing_model_is_reported_before_any_request() {
        let mut p = provider("http://127.0.0.1:1/v1");
        p.model = None;
        let err = ask("jev", &p, &Value::Null, &questions())
            .await
            .unwrap_err()
            .to_string();
        assert!(err.contains("names no model"), "{err}");
    }

    #[test]
    fn the_default_address_is_typesafes() {
        let p = Provider {
            kind: "jev".into(),
            ..Provider::default()
        };
        assert_eq!(endpoint(&p), "https://api.typesafe.ai/v1/systemone");
        let p = Provider {
            base_url: Some("http://127.0.0.1:9/v1/".into()),
            ..p
        };
        assert_eq!(endpoint(&p), "http://127.0.0.1:9/v1/systemone");
    }
}
