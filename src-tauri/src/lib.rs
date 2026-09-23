//! Command surface. Every module below stays free of Tauri types where it can;
//! this file is where they meet the frontend.

pub mod anchors;
pub mod config;
pub mod db;
pub mod diff;
pub mod documents;
pub mod error;
pub mod llm;
pub mod log;
#[cfg(target_os = "macos")]
pub mod menu;
pub mod prices;
pub mod runner;
pub mod secrets;

use error::AppResult;
use tauri::{Manager, State};

// ------------------------------------------------------------- registry

#[tauri::command]
fn db_register(db: State<db::Db>, path: String, title: String) -> AppResult<db::Document> {
    let conn = db.0.lock().unwrap();
    db::upsert_document(&conn, &path, &title)
}

#[tauri::command]
fn db_documents(db: State<db::Db>) -> AppResult<Vec<db::Document>> {
    let conn = db.0.lock().unwrap();
    db::list_documents(&conn)
}

// ------------------------------------------------------------ revisions

#[tauri::command]
fn rev_save(
    db: State<db::Db>,
    doc_id: i64,
    content_json: String,
    content_text: String,
    major: bool,
    label: Option<String>,
) -> AppResult<db::Revision> {
    let conn = db.0.lock().unwrap();
    db::save_revision(&conn, doc_id, &content_json, &content_text, major, label.as_deref())
}

#[tauri::command]
fn rev_list(db: State<db::Db>, doc_id: i64) -> AppResult<Vec<db::Revision>> {
    let conn = db.0.lock().unwrap();
    db::list_revisions(&conn, doc_id)
}

#[tauri::command]
fn rev_flag(db: State<db::Db>, id: i64, major: bool, label: Option<String>) -> AppResult<()> {
    let conn = db.0.lock().unwrap();
    db::flag_revision(&conn, id, major, label.as_deref())
}

// ----------------------------------------------------------------- runs

#[allow(clippy::too_many_arguments)]
#[tauri::command]
fn run_start(
    db: State<db::Db>,
    doc_id: i64,
    revision_id: i64,
    pass_slug: String,
    pass_name: String,
    provider: String,
    model: Option<String>,
) -> AppResult<db::Run> {
    let conn = db.0.lock().unwrap();
    db::start_run(&conn, doc_id, revision_id, &pass_slug, &pass_name, &provider, model.as_deref())
}

#[tauri::command]
fn run_finish(
    db: State<db::Db>,
    id: i64,
    status: String,
    error: Option<String>,
    usage: Option<db::Usage>,
) -> AppResult<()> {
    let conn = db.0.lock().unwrap();
    db::finish_run(&conn, id, &status, error.as_deref(), usage.unwrap_or_default())
}

/// The open file's running cost across its runs and duels (SPEC §9.4).
#[tauri::command]
fn doc_usage(db: State<db::Db>, doc_id: i64) -> AppResult<db::DocUsage> {
    let conn = db.0.lock().unwrap();
    db::doc_usage(&conn, doc_id)
}

#[tauri::command]
fn run_list(db: State<db::Db>, doc_id: i64, limit: Option<i64>) -> AppResult<Vec<db::Run>> {
    let conn = db.0.lock().unwrap();
    db::list_runs(&conn, doc_id, limit.unwrap_or(50))
}

// ------------------------------------------------------------- findings

#[tauri::command]
fn findings_add(
    db: State<db::Db>,
    run_id: i64,
    doc_id: i64,
    items: Vec<db::NewFinding>,
) -> AppResult<Vec<db::Finding>> {
    let mut conn = db.0.lock().unwrap();
    db::add_findings(&mut conn, run_id, doc_id, &items)
}

#[tauri::command]
fn findings_list(db: State<db::Db>, doc_id: i64) -> AppResult<Vec<db::Finding>> {
    let conn = db.0.lock().unwrap();
    db::list_findings(&conn, doc_id)
}

#[tauri::command]
fn findings_status(db: State<db::Db>, id: i64, status: String) -> AppResult<()> {
    let conn = db.0.lock().unwrap();
    db::set_finding_status(&conn, id, &status)
}

#[tauri::command]
fn findings_clear(db: State<db::Db>, doc_id: i64) -> AppResult<()> {
    let conn = db.0.lock().unwrap();
    db::clear_findings(&conn, doc_id)
}

// ---------------------------------------------------------------- duels

#[allow(clippy::too_many_arguments)]
#[tauri::command]
fn duel_record(
    db: State<db::Db>,
    doc_id: i64,
    finding_id: Option<i64>,
    a_text: String,
    b_text: String,
    a_is_original: bool,
    judge_provider: String,
    judge_model: Option<String>,
    verdict: String,
    reason: Option<String>,
    usage: Option<db::Usage>,
) -> AppResult<db::Duel> {
    let conn = db.0.lock().unwrap();
    db::record_duel(
        &conn,
        doc_id,
        finding_id,
        &a_text,
        &b_text,
        a_is_original,
        &judge_provider,
        judge_model.as_deref(),
        &verdict,
        reason.as_deref(),
        usage.unwrap_or_default(),
    )
}

#[tauri::command]
fn duel_list(db: State<db::Db>, doc_id: i64) -> AppResult<Vec<db::Duel>> {
    let conn = db.0.lock().unwrap();
    db::list_duels(&conn, doc_id)
}

// -------------------------------------------------------------- anchoring

// -------------------------------------------------------------- the shell

/// Open a path with the system default application. The frontend asks for
/// this rather than calling the opener plugin itself, because Rust owns the
/// filesystem.
#[tauri::command]
fn shell_open_path(path: String) -> AppResult<()> {
    tauri_plugin_opener::open_path(&path, None::<&str>)
        .map_err(|e| error::AppError::other(format!("cannot open {path}: {e}")))
}

#[tauri::command]
fn anchors_resolve(text: String, selectors: Vec<anchors::Selector>) -> Vec<anchors::Anchor> {
    anchors::resolve_all(&text, &selectors)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default();

    // macOS only: see menu.rs.
    #[cfg(target_os = "macos")]
    let builder = builder.menu(menu::build).on_menu_event(menu::on_event);

    // Debug builds only: a WebDriver server on 127.0.0.1, so tests and
    // dev/drive.ts can drive the window (SPEC §16). Any local process can use
    // it to run code in the page, so a release build never has it.
    #[cfg(debug_assertions)]
    let builder = builder.plugin(tauri_plugin_wdio_webdriver::init());

    builder
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            config::ensure_scaffold()?;
            let conn = db::open(&config::db_path())?;
            let recovered = db::recover_orphaned_runs(&conn)?;
            app.manage(db::Db(std::sync::Mutex::new(conn)));
            let _ = log::write("info", "app started");
            if recovered > 0 {
                let _ = log::write("warn", &format!("closed {recovered} run(s) left open by a previous session"));
            }
            // Prices refresh in the background. Nothing waits on them, and a
            // failure only means costs show as tokens until the next start.
            tauri::async_runtime::spawn(async {
                match prices::refresh_if_stale().await {
                    Ok(true) => { let _ = log::write("info", "prices: fetched a new copy from models.dev"); }
                    Ok(false) => {}
                    Err(e) => { let _ = log::write("warn", &e.to_string()); }
                }
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            config::config_load,
            config::config_save,
            config::config_paths,
            config::passes_list,
            secrets::secret_set,
            secrets::secret_delete,
            secrets::secret_has,
            secrets::key_resolve,
            runner::cli_run,
            llm::llm_chat,
            doc_usage,
            documents::doc_pick_open,
            documents::doc_pick_save,
            documents::doc_open,
            documents::doc_reopen,
            documents::doc_new,
            documents::doc_save,
            documents::doc_save_as,
            documents::doc_recent,
            db_register,
            db_documents,
            rev_save,
            rev_list,
            rev_flag,
            run_start,
            run_finish,
            run_list,
            findings_add,
            findings_list,
            findings_status,
            findings_clear,
            duel_record,
            duel_list,
            anchors_resolve,
            shell_open_path,
            log::app_log,
            log::log_path,
            diff::diff_words,
        ])
        .run(tauri::generate_context!())
        .expect("error while running writegood");
}
