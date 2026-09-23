//! What a call cost (SPEC §9.4).
//!
//! A provider reports tokens, never money. The rates come from models.dev,
//! which publishes every vendor's prices as one public file with no key. We
//! keep a slim copy on disk — vendor, model, rates — and refresh it in the
//! background once it is a week old. A pass never waits on the catalog, and a
//! catalog that cannot be fetched only means a cost shows as tokens.

use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::BTreeMap;
use std::path::PathBuf;
use std::sync::RwLock;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use crate::config;
use crate::error::{AppError, AppResult};

const SOURCE: &str = "https://models.dev/api.json";
const MAX_AGE: Duration = Duration::from_secs(7 * 24 * 60 * 60);

/// US dollars per million tokens. The cache rates are absent for vendors that
/// do not price them separately; the input rate stands in for them then.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Rates {
    pub input: f64,
    pub output: f64,
    // The aliases read the snake_case keys of a `price` in `config.toml`.
    #[serde(default, alias = "cache_read", skip_serializing_if = "Option::is_none")]
    pub cache_read: Option<f64>,
    #[serde(
        default,
        alias = "cache_write",
        skip_serializing_if = "Option::is_none"
    )]
    pub cache_write: Option<f64>,
}

/// The slim copy we keep: vendor id → model id → rates.
#[derive(Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Catalog {
    /// Seconds since the Unix epoch, when the copy was fetched.
    pub fetched_at: u64,
    pub vendors: BTreeMap<String, BTreeMap<String, Rates>>,
}

/// Tokens one call used. `input` is every input token, cache reads and cache
/// writes included, which is how `genai` counts them for every vendor.
#[derive(Debug, Default, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Tokens {
    pub input: u64,
    pub output: u64,
    pub cache_read: u64,
    pub cache_write: u64,
}

impl Tokens {
    /// `None` when the provider reported nothing at all, so a missing count is
    /// never shown as a count of zero.
    pub fn from_usage(usage: &genai::chat::Usage) -> Option<Tokens> {
        if usage.prompt_tokens.is_none() && usage.completion_tokens.is_none() {
            return None;
        }
        let n = |v: Option<i32>| v.unwrap_or(0).max(0) as u64;
        let details = usage.prompt_tokens_details.as_ref();
        Some(Tokens {
            input: n(usage.prompt_tokens),
            output: n(usage.completion_tokens),
            cache_read: n(details.and_then(|d| d.cached_tokens)),
            cache_write: n(details.and_then(|d| d.cache_creation_tokens)),
        })
    }
}

/// Dollars for one call. Reasoning tokens are already inside `output`, so
/// they are not charged a second time.
pub fn cost(rates: &Rates, tokens: &Tokens) -> f64 {
    let cached = tokens.cache_read + tokens.cache_write;
    let uncached = tokens.input.saturating_sub(cached);
    let read = rates.cache_read.unwrap_or(rates.input);
    let write = rates.cache_write.unwrap_or(rates.input);
    (uncached as f64 * rates.input
        + tokens.cache_read as f64 * read
        + tokens.cache_write as f64 * write
        + tokens.output as f64 * rates.output)
        / 1_000_000.0
}

/// Keep only what a lookup needs from the models.dev file. A model without a
/// numeric input and output rate is left out, so it reads as unpriced rather
/// than free.
pub fn slim(raw: &Value, fetched_at: u64) -> Catalog {
    let mut vendors = BTreeMap::new();
    let Some(all) = raw.as_object() else {
        return Catalog {
            fetched_at,
            vendors,
        };
    };
    for (vendor, entry) in all {
        let Some(models) = entry.get("models").and_then(Value::as_object) else {
            continue;
        };
        let mut priced = BTreeMap::new();
        for (model, spec) in models {
            let Some(c) = spec.get("cost") else { continue };
            let rate = |k: &str| c.get(k).and_then(Value::as_f64);
            let (Some(input), Some(output)) = (rate("input"), rate("output")) else {
                continue;
            };
            priced.insert(
                model.clone(),
                Rates {
                    input,
                    output,
                    cache_read: rate("cache_read"),
                    cache_write: rate("cache_write"),
                },
            );
        }
        if !priced.is_empty() {
            vendors.insert(vendor.clone(), priced);
        }
    }
    Catalog {
        fetched_at,
        vendors,
    }
}

pub fn path() -> PathBuf {
    config::home_dir().join("prices.json")
}

fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

fn is_fresh(fetched_at: u64, at: u64) -> bool {
    at.saturating_sub(fetched_at) < MAX_AGE.as_secs()
}

/// The catalog in memory, loaded from disk on first use.
static LOADED: RwLock<Option<Catalog>> = RwLock::new(None);

fn read_disk() -> Option<Catalog> {
    let text = std::fs::read_to_string(path()).ok()?;
    serde_json::from_str(&text).ok()
}

fn ensure_loaded() {
    if LOADED.read().map(|c| c.is_some()).unwrap_or(true) {
        return;
    }
    if let Some(catalog) = read_disk() {
        if let Ok(mut slot) = LOADED.write() {
            slot.get_or_insert(catalog);
        }
    }
}

/// The rates for one model, or `None` when the catalog has never loaded or
/// does not know the model. Matching is exact: a guessed price is worse than
/// none.
pub fn lookup(vendor: &str, model: &str) -> Option<Rates> {
    ensure_loaded();
    let slot = LOADED.read().ok()?;
    slot.as_ref()?.vendors.get(vendor)?.get(model).copied()
}

/// The rates for a provider's model: the catalog's, else the `price` the
/// provider sets in `config.toml`, else none (SPEC §9.4). The catalog wins,
/// because it follows the vendor's changes and a hand-written price does not.
pub fn rates_for(vendor: &str, model: &str, price: Option<&Rates>) -> Option<Rates> {
    choose(lookup(vendor, model), price)
}

fn choose(catalog: Option<Rates>, price: Option<&Rates>) -> Option<Rates> {
    catalog.or_else(|| price.copied())
}

/// Fetch a new copy when the one on disk is missing or a week old. Keeps the
/// old copy on any failure. Returns true when a new copy was installed.
pub async fn refresh_if_stale() -> AppResult<bool> {
    ensure_loaded();
    let fetched_at = LOADED
        .read()
        .ok()
        .and_then(|c| c.as_ref().map(|c| c.fetched_at));
    if fetched_at.is_some_and(|t| is_fresh(t, now())) {
        return Ok(false);
    }

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(60))
        .build()
        .map_err(|e| AppError::other(format!("prices: {e}")))?;
    let body = client
        .get(SOURCE)
        .send()
        .await
        .and_then(|r| r.error_for_status())
        .map_err(|e| AppError::other(format!("prices: {e}")))?
        .bytes()
        .await
        .map_err(|e| AppError::other(format!("prices: {e}")))?;

    let raw: Value = serde_json::from_slice(&body)?;
    let catalog = slim(&raw, now());
    if catalog.vendors.is_empty() {
        return Err(AppError::other(
            "prices: models.dev returned no prices; keeping the old copy",
        ));
    }

    // Write beside the target and rename, so a crash never leaves half a file.
    let target = path();
    let temp = target.with_extension("json.tmp");
    std::fs::write(&temp, serde_json::to_vec(&catalog)?)?;
    std::fs::rename(&temp, &target)?;

    if let Ok(mut slot) = LOADED.write() {
        *slot = Some(catalog);
    }
    Ok(true)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn opus() -> Rates {
        Rates {
            input: 5.0,
            output: 25.0,
            cache_read: Some(0.5),
            cache_write: Some(6.25),
        }
    }

    #[test]
    fn plain_input_and_output() {
        let t = Tokens {
            input: 2_000,
            output: 1_000,
            ..Tokens::default()
        };
        // 2000 × 5 + 1000 × 25 = 35,000 per million
        assert!((cost(&opus(), &t) - 0.035).abs() < 1e-12);
    }

    #[test]
    fn cache_tokens_are_taken_out_of_the_input_and_charged_at_their_own_rates() {
        let t = Tokens {
            input: 10_000,
            output: 0,
            cache_read: 6_000,
            cache_write: 1_000,
        };
        // uncached 3000 × 5 + read 6000 × 0.5 + write 1000 × 6.25 = 24,250
        assert!((cost(&opus(), &t) - 0.02425).abs() < 1e-12);
    }

    #[test]
    fn a_vendor_without_cache_rates_charges_cache_tokens_as_input() {
        let flat = Rates {
            input: 0.15,
            output: 0.6,
            cache_read: None,
            cache_write: None,
        };
        let t = Tokens {
            input: 1_000_000,
            output: 0,
            cache_read: 400_000,
            cache_write: 0,
        };
        assert!((cost(&flat, &t) - 0.15).abs() < 1e-12);
    }

    #[test]
    fn a_cache_count_larger_than_the_input_never_goes_negative() {
        let t = Tokens {
            input: 100,
            output: 0,
            cache_read: 500,
            cache_write: 0,
        };
        assert!(cost(&opus(), &t) >= 0.0);
    }

    #[test]
    fn missing_usage_is_not_zero_usage() {
        assert_eq!(Tokens::from_usage(&genai::chat::Usage::default()), None);
    }

    #[test]
    fn usage_reads_the_cache_details() {
        let usage: genai::chat::Usage = serde_json::from_value(json!({
            "prompt_tokens": 1200,
            "completion_tokens": 300,
            "prompt_tokens_details": { "cached_tokens": 800, "cache_creation_tokens": 100 }
        }))
        .unwrap();
        assert_eq!(
            Tokens::from_usage(&usage),
            Some(Tokens {
                input: 1200,
                output: 300,
                cache_read: 800,
                cache_write: 100
            })
        );
    }

    #[test]
    fn slim_keeps_priced_models_and_drops_the_rest() {
        let raw = json!({
            "deepseek": {
                "id": "deepseek",
                "models": {
                    "deepseek-flash": { "cost": { "input": 0.15, "output": 0.6, "reasoning": 0.6, "cache_read": 0.003 } },
                    "no-cost":        { "name": "unpriced" },
                    "half-cost":      { "cost": { "input": 1.0 } },
                    "string-cost":    { "cost": { "input": "free", "output": 1.0 } }
                }
            },
            "empty-vendor": { "models": { "x": { "name": "no price" } } },
            "not-a-vendor": "just a string"
        });
        let c = slim(&raw, 42);
        assert_eq!(c.fetched_at, 42);
        assert_eq!(c.vendors.keys().collect::<Vec<_>>(), vec!["deepseek"]);
        let ds = &c.vendors["deepseek"];
        assert_eq!(ds.keys().collect::<Vec<_>>(), vec!["deepseek-flash"]);
        assert_eq!(
            ds["deepseek-flash"],
            Rates {
                input: 0.15,
                output: 0.6,
                cache_read: Some(0.003),
                cache_write: None
            }
        );
    }

    #[test]
    fn the_catalog_price_wins_over_the_config_price() {
        let own = Rates {
            input: 0.042,
            output: 0.0,
            cache_read: None,
            cache_write: None,
        };
        assert_eq!(choose(Some(opus()), Some(&own)), Some(opus()));
        assert_eq!(choose(None, Some(&own)), Some(own));
        assert_eq!(choose(None, None), None);
    }

    #[test]
    fn a_config_price_reads_snake_case_keys() {
        let r: Rates =
            toml::from_str("input = 1.0\noutput = 2.0\ncache_read = 0.1\ncache_write = 1.5\n")
                .unwrap();
        assert_eq!(r.cache_read, Some(0.1));
        assert_eq!(r.cache_write, Some(1.5));
    }

    #[test]
    fn slim_survives_a_file_that_is_not_an_object() {
        assert!(slim(&json!([1, 2, 3]), 0).vendors.is_empty());
    }

    #[test]
    fn a_copy_goes_stale_after_seven_days() {
        let day = 24 * 60 * 60;
        assert!(is_fresh(0, 6 * day));
        assert!(!is_fresh(0, 7 * day));
    }

    #[test]
    fn the_slim_copy_round_trips_through_json() {
        let mut vendors = BTreeMap::new();
        vendors.insert(
            "anthropic".to_string(),
            BTreeMap::from([("claude-opus-5".to_string(), opus())]),
        );
        let c = Catalog {
            fetched_at: 7,
            vendors,
        };
        let back: Catalog = serde_json::from_str(&serde_json::to_string(&c).unwrap()).unwrap();
        assert_eq!(back.vendors["anthropic"]["claude-opus-5"], opus());
    }
}
