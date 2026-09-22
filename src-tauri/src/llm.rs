//! Provider calls.
//!
//! These used to run in the webview through the Vercel AI SDK. macOS suspends
//! a WebKit process whose window is not visible, which froze a pass mid-run:
//! no request, no CPU, and even the timer enforcing the timeout stopped. A
//! tokio task is not suspended, so the calls live here now. It also keeps API
//! keys out of the webview entirely and makes the boundary in CLAUDE.md true:
//! Rust owns the network as well as the filesystem.
//!
//! `genai` is the multi-provider client, the nearest Rust equivalent of the AI
//! SDK's core. It returns text; `parse.ts` still reads findings out of it, so
//! the parser's tests keep their value.

use genai::adapter::AdapterKind;
use genai::chat::{ChatMessage, ChatOptions, ChatRequest};
use genai::resolver::{AuthData, Endpoint, ServiceTargetResolver};
use genai::{Client, ModelIden, ServiceTarget};

use crate::config::Provider;
use crate::error::{AppError, AppResult};
use crate::secrets;

/// Which `genai` adapter serves a `kind` from `config.toml`.
///
/// `openai-compatible` maps to the OpenAI adapter and supplies its own base
/// URL, which is what DeepSeek, OpenRouter, Ollama and LM Studio all need.
pub fn adapter_for(kind: &str) -> AppResult<AdapterKind> {
    match kind {
        "anthropic" => Ok(AdapterKind::Anthropic),
        "openai" | "openai-compatible" => Ok(AdapterKind::OpenAI),
        "google" => Ok(AdapterKind::Gemini),
        "cli" => Err(AppError::invalid(
            "a cli provider is run as a subprocess, not through the network client",
        )),
        other => Err(AppError::invalid(format!(
            "unknown provider kind '{other}'; use anthropic, openai, google, openai-compatible or cli"
        ))),
    }
}

/// Ask a provider one question and return its reply as text.
pub async fn chat(provider: &Provider, system: &str, prompt: &str) -> AppResult<String> {
    let adapter = adapter_for(&provider.kind)?;

    let model = provider
        .model
        .clone()
        .ok_or_else(|| AppError::invalid("this provider names no model in config.toml"))?;

    let key = secrets::resolve_key(provider.key_ref.as_deref())?.ok_or_else(|| {
        AppError::invalid(
            "no key for this provider. Set key_ref in config.toml to env:NAME or \
             keychain:service/account, and put the value in the keychain or in \
             ~/.writegood/.env",
        )
    })?;

    let base_url = provider.base_url.clone();
    if provider.kind == "openai-compatible" && base_url.is_none() {
        return Err(AppError::invalid(
            "an openai-compatible provider needs a base_url in config.toml",
        ));
    }

    // One resolver covers both shapes: replace the auth always, and the
    // endpoint only when the config names one.
    let target = ServiceTargetResolver::from_resolver_fn(
        move |service: ServiceTarget| -> Result<ServiceTarget, genai::resolver::Error> {
            let ServiceTarget { endpoint, model, .. } = service;
            let endpoint = match &base_url {
                Some(url) => Endpoint::from_owned(url.clone()),
                None => endpoint,
            };
            Ok(ServiceTarget {
                endpoint,
                auth: AuthData::from_single(key.clone()),
                model: ModelIden::new(adapter, model.model_name),
            })
        },
    );

    let client = Client::builder().with_service_target_resolver(target).build();

    // A reasoning model wraps its answer in its thinking. We want the answer.
    let options = ChatOptions::default().with_normalize_reasoning_content(true);
    let request = ChatRequest::default()
        .with_system(system)
        .append_message(ChatMessage::user(prompt));

    let seconds = provider.timeout_secs.max(30);
    let call = client.exec_chat(&model, request, Some(&options));

    let response = tokio::time::timeout(std::time::Duration::from_secs(seconds), call)
        .await
        .map_err(|_| AppError::other(format!("{model} did not answer within {seconds}s")))?
        .map_err(|e| AppError::other(format!("{model}: {e}")))?;

    response
        .first_text()
        .map(str::to_string)
        .ok_or_else(|| AppError::other(format!("{model} replied with no text")))
}

#[tauri::command]
pub async fn llm_chat(provider: Provider, system: String, prompt: String) -> AppResult<String> {
    chat(&provider, &system, &prompt).await
}

#[cfg(test)]
mod tests {
    use super::*;

    fn provider(kind: &str) -> Provider {
        Provider { kind: kind.into(), ..Provider::default() }
    }

    #[test]
    fn every_network_kind_has_an_adapter() {
        assert!(matches!(adapter_for("anthropic").unwrap(), AdapterKind::Anthropic));
        assert!(matches!(adapter_for("openai").unwrap(), AdapterKind::OpenAI));
        assert!(matches!(adapter_for("google").unwrap(), AdapterKind::Gemini));
        // An OpenAI-compatible endpoint speaks the OpenAI protocol; only its
        // base URL differs, and that is supplied separately.
        assert!(matches!(adapter_for("openai-compatible").unwrap(), AdapterKind::OpenAI));
    }

    #[test]
    fn a_cli_provider_says_to_use_the_subprocess_runner() {
        let err = adapter_for("cli").unwrap_err().to_string();
        assert!(err.contains("subprocess"), "{err}");
    }

    #[test]
    fn an_unknown_kind_lists_the_ones_that_work() {
        let err = adapter_for("telepathy").unwrap_err().to_string();
        assert!(err.contains("telepathy"));
        assert!(err.contains("anthropic"));
        assert!(err.contains("openai-compatible"));
    }

    #[tokio::test]
    async fn a_missing_model_is_reported_before_any_request() {
        let mut p = provider("openai");
        p.model = None;
        let err = chat(&p, "s", "p").await.unwrap_err().to_string();
        assert!(err.contains("names no model"), "{err}");
    }

    #[tokio::test]
    async fn a_missing_key_says_where_to_put_one() {
        let mut p = provider("openai");
        p.model = Some("any-model".into());
        p.key_ref = Some("env:WRITEGOOD_KEY_THAT_IS_NOT_SET".into());
        let err = chat(&p, "s", "p").await.unwrap_err().to_string();
        assert!(err.contains("keychain"), "{err}");
        assert!(err.contains(".env"), "{err}");
    }

    #[tokio::test]
    async fn an_openai_compatible_provider_without_a_base_url_is_rejected() {
        let mut p = provider("openai-compatible");
        p.model = Some("any-model".into());
        p.key_ref = Some("env:PATH".into()); // set, so the check reaches base_url
        let err = chat(&p, "s", "p").await.unwrap_err().to_string();
        assert!(err.contains("base_url"), "{err}");
    }
}
