//! Word-level diff between two revisions.
//!
//! Line diffs are the wrong shape for prose: a paragraph is one line, so
//! changing a word reports the whole paragraph as replaced. Word granularity
//! shows what actually moved.

use serde::{Deserialize, Serialize};
use similar::{ChangeTag, TextDiff};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Chunk {
    /// `equal`, `insert` or `delete`.
    pub kind: String,
    pub text: String,
}

impl Chunk {
    fn new(kind: &str, text: String) -> Self {
        Chunk {
            kind: kind.to_string(),
            text,
        }
    }
}

fn label(tag: ChangeTag) -> &'static str {
    match tag {
        ChangeTag::Equal => "equal",
        ChangeTag::Insert => "insert",
        ChangeTag::Delete => "delete",
    }
}

/// Diff `before` against `after`, merging neighbouring changes of the same
/// kind so the caller renders a handful of spans rather than one per word.
pub fn words(before: &str, after: &str) -> Vec<Chunk> {
    let diff = TextDiff::from_words(before, after);
    let mut out: Vec<Chunk> = Vec::new();

    for change in diff.iter_all_changes() {
        let kind = label(change.tag());
        let text = change.value();
        match out.last_mut() {
            Some(last) if last.kind == kind => last.text.push_str(text),
            _ => out.push(Chunk::new(kind, text.to_string())),
        }
    }
    out
}

/// How much of the text changed, as a fraction between 0 and 1.
///
/// Whitespace is excluded. `similar` tokenises the gaps between words as
/// tokens of their own, and they match even when every word around them has
/// been replaced, so counting them puts a complete rewrite at 0.95 rather
/// than 1.
pub fn churn(before: &str, after: &str) -> f64 {
    let visible = |s: &str| s.chars().filter(|c| !c.is_whitespace()).count();
    let chunks = words(before, after);
    let changed: usize = chunks
        .iter()
        .filter(|c| c.kind != "equal")
        .map(|c| visible(&c.text))
        .sum();
    let total: usize = chunks.iter().map(|c| visible(&c.text)).sum();
    if total == 0 {
        0.0
    } else {
        changed as f64 / total as f64
    }
}

#[tauri::command]
pub fn diff_words(before: String, after: String) -> Vec<Chunk> {
    words(&before, &after)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn kinds(chunks: &[Chunk]) -> Vec<&str> {
        chunks.iter().map(|c| c.kind.as_str()).collect()
    }

    fn text_of(chunks: &[Chunk], kind: &str) -> String {
        chunks
            .iter()
            .filter(|c| c.kind == kind)
            .map(|c| c.text.as_str())
            .collect()
    }

    #[test]
    fn identical_text_is_one_equal_chunk() {
        let d = words("the committee decided", "the committee decided");
        assert_eq!(kinds(&d), vec!["equal"]);
    }

    #[test]
    fn a_replaced_word_shows_as_a_delete_and_an_insert() {
        let d = words(
            "the committee decided quickly",
            "the committee decided slowly",
        );
        assert!(text_of(&d, "delete").contains("quickly"));
        assert!(text_of(&d, "insert").contains("slowly"));
        assert!(text_of(&d, "equal").contains("committee"));
    }

    #[test]
    fn runs_of_the_same_kind_merge() {
        let d = words("one two three four", "one nine ten four");
        assert!(text_of(&d, "delete").contains("two"));
        assert!(text_of(&d, "delete").contains("three"));
        assert!(text_of(&d, "insert").contains("nine"));
        // No two neighbours share a kind: the merge did its job. The chunk
        // count stays higher than you might expect because `similar` treats
        // the space between two changed words as an unchanged token.
        for pair in d.windows(2) {
            assert_ne!(pair[0].kind, pair[1].kind, "{:?}", kinds(&d));
        }
    }

    #[test]
    fn whitespace_between_two_changed_words_stays_equal() {
        // Documenting `similar`'s behaviour, because churn has to work around
        // it and a future reader will otherwise think this is a bug.
        let d = words("alpha beta", "gamma delta");
        let equal = text_of(&d, "equal");
        assert!(!equal.is_empty());
        assert!(
            equal.trim().is_empty(),
            "expected only whitespace, got {equal:?}"
        );
    }

    #[test]
    fn an_insertion_at_the_end_is_the_only_change() {
        let d = words("the meeting ended", "the meeting ended badly");
        assert_eq!(text_of(&d, "delete"), "");
        assert!(text_of(&d, "insert").contains("badly"));
    }

    #[test]
    fn writing_from_nothing_is_all_insert() {
        let d = words("", "a first sentence");
        assert_eq!(kinds(&d), vec!["insert"]);
    }

    #[test]
    fn deleting_everything_is_all_delete() {
        let d = words("a first sentence", "");
        assert_eq!(kinds(&d), vec!["delete"]);
    }

    #[test]
    fn the_diff_reconstructs_both_sides() {
        let before = "It was decided by the committee that a determination would be made.";
        let after = "The committee decided.";
        let d = words(before, after);
        let rebuilt_before: String = d
            .iter()
            .filter(|c| c.kind != "insert")
            .map(|c| c.text.as_str())
            .collect();
        let rebuilt_after: String = d
            .iter()
            .filter(|c| c.kind != "delete")
            .map(|c| c.text.as_str())
            .collect();
        assert_eq!(rebuilt_before, before);
        assert_eq!(rebuilt_after, after);
    }

    #[test]
    fn churn_is_zero_for_no_change_and_one_for_a_full_rewrite() {
        assert_eq!(churn("same words here", "same words here"), 0.0);
        assert_eq!(churn("", ""), 0.0);
        assert_eq!(churn("alpha beta", "gamma delta"), 1.0);
        let partial = churn("one two three four", "one two three five");
        assert!(partial > 0.0 && partial < 1.0, "got {partial}");
    }

    #[test]
    fn counts_characters_not_bytes() {
        let c = churn("café crème", "café noir");
        assert!(c > 0.0 && c < 1.0, "got {c}");
    }
}
