//! Re-anchoring findings to text that has since been edited.
//!
//! A finding is stored as a W3C-style text quote selector: the exact quote plus
//! a short run of context on either side. That survives a reload, and it mostly
//! survives the author rewriting a neighbouring paragraph. It does not survive
//! the author rewriting the quoted sentence itself, which is the point - once
//! the sentence is gone the finding is stale and should say so.
//!
//! All offsets here are in Unicode scalar values (Rust `char`s), not bytes and
//! not UTF-16 code units. The frontend builds its position table the same way.

use serde::{Deserialize, Serialize};

/// How much context either side of the quote we store and compare.
pub const CONTEXT_LEN: usize = 32;

/// A quote must reach this similarity on its own before we will place it.
const MIN_QUOTE_SIM: f64 = 0.60;
/// Combined quote + context score needed to accept a placement.
const MIN_TOTAL_SCORE: f64 = 0.65;
/// Candidate windows are sized within this factor of the original quote.
const WINDOW_SLACK: f64 = 0.25;
/// Tokens shorter than this are too common to seed a candidate search.
const MIN_SEED_LEN: usize = 4;
/// Give up rather than score an unbounded number of windows.
const MAX_CANDIDATES: usize = 4000;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Selector {
    /// Caller's own identifier, echoed back so results can be matched up.
    pub id: i64,
    pub quote: String,
    #[serde(default)]
    pub prefix: String,
    #[serde(default)]
    pub suffix: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Anchor {
    pub id: i64,
    /// `None` when the quote can no longer be placed: the finding is stale.
    pub from: Option<usize>,
    pub to: Option<usize>,
    pub score: f64,
    pub exact: bool,
}

impl Anchor {
    fn stale(id: i64) -> Self {
        Anchor { id, from: None, to: None, score: 0.0, exact: false }
    }
}

/// Resolve every selector against the current document text.
pub fn resolve_all(text: &str, selectors: &[Selector]) -> Vec<Anchor> {
    let chars: Vec<char> = text.chars().collect();
    let lower: Vec<char> = text.to_lowercase().chars().collect();
    // `to_lowercase` can change the length of the string for a few characters
    // (e.g. 'İ'). Fall back to the original when that happens so the two
    // indexes stay aligned.
    let lower = if lower.len() == chars.len() { lower } else { chars.clone() };

    selectors
        .iter()
        .map(|s| resolve_one(&chars, &lower, s))
        .collect()
}

fn resolve_one(chars: &[char], lower: &[char], sel: &Selector) -> Anchor {
    let quote: Vec<char> = sel.quote.chars().collect();
    if quote.is_empty() || chars.is_empty() {
        return Anchor::stale(sel.id);
    }

    let quote_lower: Vec<char> = lowercase_aligned(&quote);

    // 1. Exact (case-insensitive) hits. Usually there is exactly one.
    let exact = find_all(lower, &quote_lower, usize::MAX);
    if !exact.is_empty() {
        let best = exact
            .iter()
            .map(|&at| (at, context_score(chars, at, quote.len(), sel)))
            .max_by(|a, b| a.1.total_cmp(&b.1))
            .map(|(at, ctx)| (at, ctx))
            .unwrap();
        return Anchor {
            id: sel.id,
            from: Some(best.0),
            to: Some(best.0 + quote.len()),
            score: 1.0_f64.min(0.85 + 0.15 * best.1),
            exact: true,
        };
    }

    // 2. Fuzzy. Seed candidate windows on the rarest long token in the quote,
    //    so we never scan the whole document for every finding.
    let candidates = seed_candidates(lower, &quote_lower);
    if candidates.is_empty() {
        return Anchor::stale(sel.id);
    }

    let qlen = quote.len();
    let min_len = ((qlen as f64) * (1.0 - WINDOW_SLACK)).round().max(1.0) as usize;
    let max_len = ((qlen as f64) * (1.0 + WINDOW_SLACK)).round() as usize;

    let mut best: Option<(usize, usize, f64, f64)> = None; // from, to, total, quote_sim
    for start in candidates {
        for len in [min_len, qlen, max_len] {
            let end = (start + len).min(chars.len());
            if end <= start {
                continue;
            }
            let window: String = chars[start..end].iter().collect();
            let qsim = strsim::normalized_levenshtein(&window.to_lowercase(), &sel.quote.to_lowercase());
            if qsim < MIN_QUOTE_SIM {
                continue;
            }
            let ctx = context_score(chars, start, end - start, sel);
            let total = 0.75 * qsim + 0.25 * ctx;
            if best.map_or(true, |(_, _, b, _)| total > b) {
                best = Some((start, end, total, qsim));
            }
        }
    }

    match best {
        Some((from, to, total, _)) if total >= MIN_TOTAL_SCORE => Anchor {
            id: sel.id,
            from: Some(from),
            to: Some(to),
            score: total,
            exact: false,
        },
        _ => Anchor::stale(sel.id),
    }
}

/// Lowercase a char slice while keeping one output char per input char.
fn lowercase_aligned(src: &[char]) -> Vec<char> {
    src.iter()
        .map(|c| {
            let mut it = c.to_lowercase();
            let first = it.next().unwrap_or(*c);
            if it.next().is_some() {
                *c
            } else {
                first
            }
        })
        .collect()
}

/// Every start index at which `needle` occurs in `haystack`, up to `limit`.
fn find_all(haystack: &[char], needle: &[char], limit: usize) -> Vec<usize> {
    let mut out = Vec::new();
    if needle.is_empty() || needle.len() > haystack.len() {
        return out;
    }
    let last = haystack.len() - needle.len();
    for i in 0..=last {
        if haystack[i..i + needle.len()] == *needle {
            out.push(i);
            if out.len() >= limit {
                break;
            }
        }
    }
    out
}

/// Candidate window starts, found by locating distinctive tokens of the quote.
///
/// Longest tokens first: they are the rarest, so they give the fewest and most
/// relevant candidates. We stop as soon as one token produces a workable set.
fn seed_candidates(lower: &[char], quote_lower: &[char]) -> Vec<usize> {
    let mut tokens: Vec<(usize, Vec<char>)> = Vec::new(); // offset in quote, token
    let mut start: Option<usize> = None;
    for (i, c) in quote_lower.iter().enumerate() {
        if c.is_alphanumeric() {
            start.get_or_insert(i);
        } else if let Some(s) = start.take() {
            tokens.push((s, quote_lower[s..i].to_vec()));
        }
    }
    if let Some(s) = start {
        tokens.push((s, quote_lower[s..].to_vec()));
    }
    tokens.retain(|(_, t)| t.len() >= MIN_SEED_LEN);
    tokens.sort_by(|a, b| b.1.len().cmp(&a.1.len()));

    let mut candidates: Vec<usize> = Vec::new();
    for (offset, token) in tokens.iter().take(4) {
        for hit in find_all(lower, token, MAX_CANDIDATES) {
            // The window starts where the quote would start, given that this
            // token sits `offset` characters into it.
            let from = hit.saturating_sub(*offset);
            candidates.push(from);
        }
        if !candidates.is_empty() && candidates.len() < MAX_CANDIDATES {
            break;
        }
        if candidates.len() >= MAX_CANDIDATES {
            candidates.truncate(MAX_CANDIDATES);
            break;
        }
    }
    candidates.sort_unstable();
    candidates.dedup();
    candidates
}

/// How well the text around a placement matches the stored context.
fn context_score(chars: &[char], from: usize, len: usize, sel: &Selector) -> f64 {
    let to = (from + len).min(chars.len());
    let before_start = from.saturating_sub(CONTEXT_LEN);
    let before: String = chars[before_start..from].iter().collect();
    let after_end = (to + CONTEXT_LEN).min(chars.len());
    let after: String = chars[to..after_end].iter().collect();

    let mut score = 0.0;
    let mut weight = 0.0;
    if !sel.prefix.is_empty() {
        score += strsim::normalized_levenshtein(&before.to_lowercase(), &sel.prefix.to_lowercase());
        weight += 1.0;
    }
    if !sel.suffix.is_empty() {
        score += strsim::normalized_levenshtein(&after.to_lowercase(), &sel.suffix.to_lowercase());
        weight += 1.0;
    }
    if weight == 0.0 {
        0.5
    } else {
        score / weight
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sel(quote: &str, prefix: &str, suffix: &str) -> Selector {
        Selector { id: 1, quote: quote.into(), prefix: prefix.into(), suffix: suffix.into() }
    }

    fn one(text: &str, s: Selector) -> Anchor {
        resolve_all(text, &[s]).remove(0)
    }

    #[test]
    fn places_an_exact_quote() {
        let text = "The committee made a determination that the proposal was sound.";
        let a = one(text, sel("made a determination", "The committee ", " that the"));
        assert!(a.exact);
        assert_eq!(a.from, Some(14));
        assert_eq!(a.to, Some(34));
    }

    #[test]
    fn ignores_case_when_placing() {
        let text = "The Committee Made A Determination about it.";
        let a = one(text, sel("made a determination", "", ""));
        assert!(a.exact);
        assert_eq!(a.from, Some(14));
    }

    #[test]
    fn uses_context_to_pick_between_duplicate_quotes() {
        let text = "alpha: the same words here. beta: the same words here.";
        let a = one(text, sel("the same words", "beta: ", " here."));
        assert!(a.exact);
        assert!(a.from.unwrap() > 27, "expected the second occurrence, got {:?}", a.from);
    }

    #[test]
    fn survives_a_small_edit_inside_the_quote() {
        let original = "The committee made a determination that the proposal was sound.";
        let edited = "The committee made a determination that this proposal was sound.";
        let s = sel("a determination that the proposal", "committee made ", " was sound.");
        let before = one(original, s.clone());
        assert!(before.exact);
        let after = one(edited, s);
        assert!(!after.exact, "an edited quote should not match exactly");
        assert!(after.from.is_some(), "a one-word edit should still re-anchor");
        assert!(after.score > MIN_TOTAL_SCORE);
    }

    #[test]
    fn survives_an_edit_in_a_neighbouring_sentence() {
        let original = "Some throat clearing first. The committee made a determination.";
        let edited = "A wholly different opening line. The committee made a determination.";
        let s = sel("made a determination", "The committee ", ".");
        assert!(one(original, s.clone()).from.is_some());
        let after = one(edited, s);
        assert!(after.exact, "the quote itself is untouched");
    }

    #[test]
    fn goes_stale_when_the_sentence_is_rewritten() {
        let edited = "The committee decided the proposal held up.";
        let a = one(edited, sel("made a determination that the proposal", "committee ", " was sound"));
        assert_eq!(a.from, None, "a full rewrite should go stale, not mis-place");
    }

    #[test]
    fn goes_stale_on_an_empty_document() {
        let a = one("", sel("anything at all", "", ""));
        assert_eq!(a.from, None);
    }

    #[test]
    fn handles_an_empty_quote() {
        let a = one("some text", sel("", "", ""));
        assert_eq!(a.from, None);
    }

    #[test]
    fn counts_in_characters_not_bytes() {
        let text = "Café — the committee made a determination.";
        let a = one(text, sel("made a determination", "", ""));
        assert!(a.exact);
        let chars: Vec<char> = text.chars().collect();
        let got: String = chars[a.from.unwrap()..a.to.unwrap()].iter().collect();
        assert_eq!(got, "made a determination");
    }

    #[test]
    fn resolves_many_selectors_in_one_pass() {
        let text = "Very good. Really quite unfortunately bad. Actually fine.";
        let out = resolve_all(
            text,
            &[
                Selector { id: 10, quote: "Very".into(), prefix: "".into(), suffix: " good".into() },
                Selector { id: 11, quote: "unfortunately".into(), prefix: "quite ".into(), suffix: " bad".into() },
                Selector { id: 12, quote: "nothing like this".into(), prefix: "".into(), suffix: "".into() },
            ],
        );
        assert_eq!(out.len(), 3);
        assert_eq!(out[0].id, 10);
        assert!(out[0].from.is_some());
        assert!(out[1].from.is_some());
        assert_eq!(out[2].from, None);
    }

    #[test]
    fn stays_fast_on_a_long_document() {
        let body = "The committee made a determination that the proposal was sound. ".repeat(400);
        let text = format!("{body}A single distinctive terminating clause appears once.");
        let started = std::time::Instant::now();
        let a = one(&text, sel("distinctive terminating clause", "A single ", " appears"));
        assert!(a.exact);
        assert!(started.elapsed().as_millis() < 250, "took {:?}", started.elapsed());
    }
}
