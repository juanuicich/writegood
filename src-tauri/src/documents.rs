//! Markdown files on disk. The file is the document (SPEC 6.1); the database
//! only keeps history and findings. Everything here is ordinary file IO, kept
//! in Rust so the webview never touches the filesystem.

use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Runtime, State};
use tauri_plugin_dialog::DialogExt;

use crate::config;
use crate::db;
use crate::error::{AppError, AppResult};

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

    // The editor's serialiser emits no trailing newline. Text files should end
    // with one, or every other tool that reads the file complains.
    let mut body = text.to_string();
    if !body.is_empty() && !body.ends_with('\n') {
        body.push('\n');
    }

    std::fs::write(&tmp, &body)?;
    std::fs::rename(&tmp, &target)?;
    Ok(())
}

/// A path with no extension gets `.md` (SPEC §6.3).
pub fn with_markdown_extension(path: &str) -> String {
    if Path::new(path).extension().is_some() {
        path.to_string()
    } else {
        format!("{path}.md")
    }
}

/// Where a dialog starts: the open document's folder, else the documents
/// folder.
fn start_dir(from: Option<&str>) -> PathBuf {
    from.and_then(|p| Path::new(p).parent())
        .filter(|d| d.is_dir())
        .map(Path::to_path_buf)
        .unwrap_or_else(config::documents_dir)
}

/// The recovery file of an untitled draft. Autosave writes here until the
/// first save gives the draft a file of its own.
pub fn recovery_path(id: i64) -> PathBuf {
    config::untitled_dir().join(format!("{id}.md"))
}

/// Where a document's text lives now: its file, or its recovery file.
fn text_path(doc: &db::Document) -> PathBuf {
    doc.path.as_ref().map(PathBuf::from).unwrap_or_else(|| recovery_path(doc.id))
}

fn title_for(text: &str, path: Option<&str>) -> String {
    title_of(text, Path::new(path.unwrap_or("untitled")))
}

/// A document and its text, as the editor loads it.
#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Opened {
    pub doc: db::Document,
    pub text: String,
}

/// One line of the recent list.
#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Recent {
    pub id: i64,
    pub path: Option<String>,
    pub title: String,
}

/// Opened documents whose text is still on disk, newest first. A missing
/// file is left out of the list. Its row stays.
pub fn recent(conn: &Connection) -> AppResult<Vec<Recent>> {
    Ok(db::opened_documents(conn)?
        .into_iter()
        .filter(|d| text_path(d).is_file())
        .take(20)
        .map(|d| Recent { id: d.id, path: d.path, title: d.title })
        .collect())
}

/// Record the open, then rebuild File > Open Recent.
fn opened<R: Runtime>(app: &AppHandle<R>, conn: &Connection, doc: db::Document, text: String) -> AppResult<Opened> {
    db::touch_opened(conn, doc.id)?;
    refresh_menu(app, conn);
    Ok(Opened { doc: db::get_document(conn, doc.id)?, text })
}

#[cfg(target_os = "macos")]
fn refresh_menu<R: Runtime>(app: &AppHandle<R>, conn: &Connection) {
    if let Ok(list) = recent(conn) {
        crate::menu::refresh_recent(app, &list);
    }
}

#[cfg(not(target_os = "macos"))]
fn refresh_menu<R: Runtime>(_app: &AppHandle<R>, _conn: &Connection) {}

/// Debug builds only: when `WRITEGOOD_PICK` names a file, the pick commands
/// return its first line and show no dialog. An empty line is a cancel.
/// WebDriver cannot drive a native dialog, so the e2e tests answer here
/// (SPEC §6.3).
fn test_pick() -> Option<Option<String>> {
    if !cfg!(debug_assertions) {
        return None;
    }
    let file = std::env::var_os("WRITEGOOD_PICK")?;
    let text = std::fs::read_to_string(file).unwrap_or_default();
    let line = text.lines().next().unwrap_or("").trim().to_string();
    Some(if line.is_empty() { None } else { Some(line) })
}

fn picked(path: Option<tauri_plugin_dialog::FilePath>) -> Option<String> {
    path.and_then(|p| p.into_path().ok()).map(|p| p.to_string_lossy().into_owned())
}

// ----------------------------------------------------------------- commands

/// The native open dialog. None when the author cancels.
#[tauri::command]
pub async fn doc_pick_open(app: AppHandle, from: Option<String>) -> AppResult<Option<String>> {
    if let Some(answer) = test_pick() {
        return Ok(answer);
    }
    let path = app
        .dialog()
        .file()
        .add_filter("Markdown", &["md", "markdown", "mdown"])
        .add_filter("Text", &["txt"])
        .set_directory(start_dir(from.as_deref()))
        .blocking_pick_file();
    Ok(picked(path))
}

/// The native save dialog. The name it returns always has an extension.
#[tauri::command]
pub async fn doc_pick_save(
    app: AppHandle,
    suggested: String,
    from: Option<String>,
) -> AppResult<Option<String>> {
    let answer = match test_pick() {
        Some(answer) => answer,
        None => picked(
            app.dialog()
                .file()
                .add_filter("Markdown", &["md", "markdown", "mdown"])
                .add_filter("Text", &["txt"])
                .set_directory(start_dir(from.as_deref()))
                .set_file_name(format!("{}.md", slugify(&suggested)))
                .blocking_save_file(),
        ),
    };
    Ok(answer.map(|p| with_markdown_extension(&p)))
}

/// Open a file by path. A path the database knows keeps its row and history.
#[tauri::command]
pub fn doc_open(app: AppHandle, db: State<db::Db>, path: String) -> AppResult<Opened> {
    let text = read(&path)?;
    let conn = db.0.lock().unwrap();
    let doc = db::upsert_document(&conn, &path, &title_for(&text, Some(&path)))?;
    opened(&app, &conn, doc, text)
}

/// Open a document by id: a recent file, or an untitled draft's recovery file.
#[tauri::command]
pub fn doc_reopen(app: AppHandle, db: State<db::Db>, id: i64) -> AppResult<Opened> {
    let conn = db.0.lock().unwrap();
    let doc = db::get_document(&conn, id)?;
    let text = read(&text_path(&doc).to_string_lossy())?;
    opened(&app, &conn, doc, text)
}

/// A new untitled draft. It has no file until the first save.
#[tauri::command]
pub fn doc_new(app: AppHandle, db: State<db::Db>) -> AppResult<Opened> {
    let conn = db.0.lock().unwrap();
    let doc = db::create_untitled(&conn, "untitled")?;
    opened(&app, &conn, doc, String::new())
}

/// Write a document where it lives: its file, or its recovery file. The path
/// comes from the row, so the webview cannot name a file to write.
#[tauri::command]
pub fn doc_save(db: State<db::Db>, id: i64, text: String) -> AppResult<db::Document> {
    let conn = db.0.lock().unwrap();
    let doc = db::get_document(&conn, id)?;
    write(&text_path(&doc).to_string_lossy(), &text)?;
    db::rename_document(&conn, id, &title_for(&text, doc.path.as_deref()))?;
    db::get_document(&conn, id)
}

/// Write a document to a new file and point its row there. The first save of
/// an untitled draft is a Save As. The old file stays; a recovery file goes.
#[tauri::command]
pub fn doc_save_as(app: AppHandle, db: State<db::Db>, id: i64, path: String, text: String) -> AppResult<db::Document> {
    let path = with_markdown_extension(&path);
    let conn = db.0.lock().unwrap();
    // Refuse before writing: the file must not change under another row.
    if let Ok(other) = db::get_document_by_path(&conn, &path) {
        if other.id != id {
            return Err(AppError::invalid(format!(
                "{path} is already open as another document. Choose another name."
            )));
        }
    }
    write(&path, &text)?;
    let doc = db::move_document(&conn, id, &path, &title_for(&text, Some(&path)))?;
    let recovery = recovery_path(id);
    if recovery.exists() {
        std::fs::remove_file(recovery)?;
    }
    db::touch_opened(&conn, id)?;
    refresh_menu(&app, &conn);
    Ok(doc)
}

/// Recent documents for the command bar.
#[tauri::command]
pub fn doc_recent(db: State<db::Db>) -> AppResult<Vec<Recent>> {
    let conn = db.0.lock().unwrap();
    recent(&conn)
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
    fn writes_atomically_and_leaves_no_temp_file() {
        let home = env_home("docs-write");
        let path = home.dir.join("documents").join("a.md");
        write(&path.to_string_lossy(), "hello").unwrap();
        assert_eq!(read(&path.to_string_lossy()).unwrap(), "hello\n", "files end with a newline");
        write(&path.to_string_lossy(), "already\n").unwrap();
        assert_eq!(read(&path.to_string_lossy()).unwrap(), "already\n", "and not two");
        let leftovers: Vec<_> = std::fs::read_dir(home.dir.join("documents"))
            .unwrap()
            .filter_map(Result::ok)
            .filter(|e| e.file_name().to_string_lossy().ends_with(".tmp"))
            .collect();
        assert!(leftovers.is_empty(), "temp file left behind");
    }

    #[test]
    fn a_name_with_no_extension_gets_md() {
        assert_eq!(with_markdown_extension("/x/draft"), "/x/draft.md");
        assert_eq!(with_markdown_extension("/x/draft.md"), "/x/draft.md");
        assert_eq!(with_markdown_extension("/x/notes.txt"), "/x/notes.txt");
    }

    #[test]
    fn an_untitled_draft_takes_its_title_from_its_heading() {
        assert_eq!(title_for("", None), "untitled");
        assert_eq!(title_for("# A Piece\n\ntext", None), "A Piece");
    }
}
