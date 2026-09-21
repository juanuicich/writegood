//! Markdown files on disk. The file is the document (SPEC 6.1); the database
//! only keeps history and findings. Everything here is ordinary file IO, kept
//! in Rust so the webview never touches the filesystem.

use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

use crate::config;
use crate::error::{AppError, AppResult};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DocSummary {
    pub path: String,
    pub title: String,
    /// Seconds since the epoch, for ordering. Zero when the platform will not say.
    pub modified: u64,
    pub words: usize,
}

/// The document's title: its first level-one heading, else the file name.
pub fn title_of(text: &str, path: &Path) -> String {
    for line in text.lines().take(40) {
        let line = line.trim();
        if let Some(rest) = line.strip_prefix("# ") {
            let t = rest.trim();
            if !t.is_empty() {
                return t.to_string();
            }
        }
    }
    path.file_stem()
        .map(|s| s.to_string_lossy().replace(['-', '_'], " "))
        .unwrap_or_else(|| "Untitled".into())
}

pub fn word_count(text: &str) -> usize {
    text.split_whitespace().filter(|w| w.chars().any(char::is_alphanumeric)).count()
}

/// A file name that will not surprise anyone later: lowercase, dashes, ASCII.
pub fn slugify(title: &str) -> String {
    let mut out = String::new();
    let mut dash = false;
    for c in title.chars() {
        if c.is_ascii_alphanumeric() {
            out.push(c.to_ascii_lowercase());
            dash = false;
        } else if !out.is_empty() && !dash {
            out.push('-');
            dash = true;
        }
    }
    let trimmed = out.trim_matches('-').to_string();
    if trimmed.is_empty() {
        "untitled".into()
    } else {
        trimmed.chars().take(60).collect()
    }
}

fn is_markdown(path: &Path) -> bool {
    matches!(
        path.extension().and_then(|e| e.to_str()).map(str::to_ascii_lowercase).as_deref(),
        Some("md") | Some("markdown") | Some("mdown") | Some("txt")
    )
}

pub fn list() -> AppResult<Vec<DocSummary>> {
    config::ensure_scaffold()?;
    let dir = config::documents_dir();
    let mut out = Vec::new();
    for entry in std::fs::read_dir(&dir)? {
        let entry = entry?;
        let path = entry.path();
        if !path.is_file() || !is_markdown(&path) {
            continue;
        }
        let text = std::fs::read_to_string(&path).unwrap_or_default();
        let modified = entry
            .metadata()
            .and_then(|m| m.modified())
            .ok()
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| d.as_secs())
            .unwrap_or(0);
        out.push(DocSummary {
            title: title_of(&text, &path),
            words: word_count(&text),
            path: path.to_string_lossy().into_owned(),
            modified,
        });
    }
    out.sort_by(|a, b| b.modified.cmp(&a.modified).then_with(|| a.title.cmp(&b.title)));
    Ok(out)
}

pub fn read(path: &str) -> AppResult<String> {
    Ok(std::fs::read_to_string(path)?)
}

/// Write via a temporary file in the same directory, then rename. A crash
/// half way through leaves the previous draft intact rather than a truncated
/// one. This is the only place the app writes a document.
pub fn write(path: &str, text: &str) -> AppResult<()> {
    let target = PathBuf::from(path);
    let dir = target
        .parent()
        .ok_or_else(|| AppError::invalid(format!("{path} has no parent directory")))?;
    std::fs::create_dir_all(dir)?;

    let name = target
        .file_name()
        .ok_or_else(|| AppError::invalid(format!("{path} is not a file name")))?
        .to_string_lossy()
        .into_owned();
    let tmp = dir.join(format!(".{name}.tmp"));

    std::fs::write(&tmp, text)?;
    std::fs::rename(&tmp, &target)?;
    Ok(())
}

/// Create a new draft. Never overwrites: a clashing name gets a numeric suffix.
pub fn create(title: &str) -> AppResult<String> {
    config::ensure_scaffold()?;
    let dir = config::documents_dir();
    let stem = slugify(title);
    let mut path = dir.join(format!("{stem}.md"));
    let mut n = 2;
    while path.exists() {
        path = dir.join(format!("{stem}-{n}.md"));
        n += 1;
    }
    let body = format!("# {}\n\n", title.trim());
    write(&path.to_string_lossy(), &body)?;
    Ok(path.to_string_lossy().into_owned())
}

pub fn delete(path: &str) -> AppResult<()> {
    std::fs::remove_file(path)?;
    Ok(())
}

pub fn rename(path: &str, new_title: &str) -> AppResult<String> {
    let old = PathBuf::from(path);
    let dir = old.parent().ok_or_else(|| AppError::invalid("no parent directory"))?;
    let mut target = dir.join(format!("{}.md", slugify(new_title)));
    let mut n = 2;
    while target.exists() && target != old {
        target = dir.join(format!("{}-{n}.md", slugify(new_title)));
        n += 1;
    }
    if target != old {
        std::fs::rename(&old, &target)?;
    }
    Ok(target.to_string_lossy().into_owned())
}

// ----------------------------------------------------------------- commands

#[tauri::command]
pub fn doc_list() -> AppResult<Vec<DocSummary>> {
    list()
}

#[tauri::command]
pub fn doc_read(path: String) -> AppResult<String> {
    read(&path)
}

#[tauri::command]
pub fn doc_write(path: String, text: String) -> AppResult<()> {
    write(&path, &text)
}

#[tauri::command]
pub fn doc_create(title: String) -> AppResult<String> {
    create(&title)
}

#[tauri::command]
pub fn doc_delete(path: String) -> AppResult<()> {
    delete(&path)
}

#[tauri::command]
pub fn doc_rename(path: String, title: String) -> AppResult<String> {
    rename(&path, &title)
}

#[cfg(test)]
mod tests {
    use super::*;

    use crate::config::testing::env_home;

    #[test]
    fn takes_the_title_from_the_first_heading() {
        let t = title_of("# On Writing\n\nSome text.", Path::new("/x/whatever.md"));
        assert_eq!(t, "On Writing");
    }

    #[test]
    fn falls_back_to_the_file_name() {
        let t = title_of("No heading here.", Path::new("/x/on-writing-well.md"));
        assert_eq!(t, "on writing well");
    }

    #[test]
    fn ignores_a_heading_that_is_not_level_one() {
        let t = title_of("## Subsection\n\ntext", Path::new("/x/draft.md"));
        assert_eq!(t, "draft");
    }

    #[test]
    fn slugs_are_boring_and_safe() {
        assert_eq!(slugify("On Writing: A Memoir!"), "on-writing-a-memoir");
        assert_eq!(slugify("   "), "untitled");
        assert_eq!(slugify("Café über alles"), "caf-ber-alles");
    }

    #[test]
    fn counts_words_not_punctuation() {
        assert_eq!(word_count("one two three"), 3);
        assert_eq!(word_count("one — two"), 2);
        assert_eq!(word_count(""), 0);
    }

    #[test]
    fn writes_atomically_and_leaves_no_temp_file() {
        let home = env_home("docs-write");
        let path = home.dir.join("documents").join("a.md");
        write(&path.to_string_lossy(), "hello").unwrap();
        assert_eq!(read(&path.to_string_lossy()).unwrap(), "hello");
        let leftovers: Vec<_> = std::fs::read_dir(home.dir.join("documents"))
            .unwrap()
            .filter_map(Result::ok)
            .filter(|e| e.file_name().to_string_lossy().ends_with(".tmp"))
            .collect();
        assert!(leftovers.is_empty(), "temp file left behind");
    }

    #[test]
    fn creating_twice_does_not_overwrite() {
        let _home = env_home("docs-create");
        let a = create("Draft").unwrap();
        let b = create("Draft").unwrap();
        assert_ne!(a, b);
        assert!(b.ends_with("draft-2.md"), "got {b}");
    }

    #[test]
    fn lists_only_markdown_and_newest_first() {
        let home = env_home("docs-list");
        create("Older").unwrap();
        std::thread::sleep(std::time::Duration::from_millis(1100));
        create("Newer").unwrap();
        std::fs::write(home.dir.join("documents").join("notes.png"), "x").unwrap();
        let docs = list().unwrap();
        assert_eq!(docs.len(), 2, "png should be ignored");
        assert_eq!(docs[0].title, "Newer");
    }
}
