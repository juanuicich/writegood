//! The macOS menu bar.
//!
//! The menu is macOS-only on purpose. On macOS the menu lives in the system
//! bar, outside the window, so it costs the document nothing. On Windows and
//! Linux a Tauri menu is drawn inside the window frame, above the text, which
//! is the in-app chrome the app rules out (SPEC §12.1). Those platforms get
//! the keyboard and `⌘K` instead.
//!
//! Every custom item carries the accelerator the keyboard already uses, and
//! every custom item emits `menu-command` with the id of a palette command.
//! The frontend runs that command through the same code path the palette runs,
//! so the menu and the keyboard cannot drift apart.

use tauri::menu::{AboutMetadata, Menu, MenuEvent, MenuItem, PredefinedMenuItem, Submenu};
use tauri::{AppHandle, Emitter, Manager, Runtime};

/// The event the webview listens for. Its payload is a palette command id.
const EVENT: &str = "menu-command";

/// Handled in Rust: Rust owns the filesystem, so Rust opens the folder.
const OPEN_HOME: &str = "open-home";

/// The builder calls this before it creates the window. Setting the menu later
/// does not take: the window is created with the default menu and keeps it.
pub fn build<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<Menu<R>> {
    let about = PredefinedMenuItem::about(app, None, Some(AboutMetadata::default()))?;

    let app_menu = Submenu::with_items(
        app,
        "writegood",
        true,
        &[
            &about,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::hide(app, None)?,
            &PredefinedMenuItem::hide_others(app, None)?,
            &PredefinedMenuItem::show_all(app, None)?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::quit(app, None)?,
        ],
    )?;

    let file = Submenu::with_items(
        app,
        "File",
        true,
        &[
            &MenuItem::with_id(app, "new", "New document", true, Some("CmdOrCtrl+N"))?,
            &MenuItem::with_id(app, "open", "Open document", true, Some("CmdOrCtrl+O"))?,
            &MenuItem::with_id(app, "save", "Save", true, Some("CmdOrCtrl+S"))?,
            &MenuItem::with_id(
                app,
                "major",
                "Save as major revision",
                true,
                Some("CmdOrCtrl+Shift+S"),
            )?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(app, OPEN_HOME, "Open the writegood folder", true, None::<&str>)?,
        ],
    )?;

    // WKWebView takes copy, paste, undo and the rest from the menu. Without
    // these items a writing app cannot copy or paste.
    let edit = Submenu::with_items(
        app,
        "Edit",
        true,
        &[
            &PredefinedMenuItem::undo(app, None)?,
            &PredefinedMenuItem::redo(app, None)?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::cut(app, None)?,
            &PredefinedMenuItem::copy(app, None)?,
            &PredefinedMenuItem::paste(app, None)?,
            &PredefinedMenuItem::select_all(app, None)?,
        ],
    )?;

    let review = Submenu::with_items(
        app,
        "Review",
        true,
        &[
            &MenuItem::with_id(app, "run", "Run all passes", true, Some("CmdOrCtrl+R"))?,
            &MenuItem::with_id(
                app,
                "run-one",
                "Run one pass",
                true,
                Some("CmdOrCtrl+Shift+R"),
            )?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(app, "history", "Revisions", true, Some("CmdOrCtrl+Y"))?,
            &MenuItem::with_id(
                app,
                "duel",
                "Compare a rewrite of this paragraph",
                true,
                Some("CmdOrCtrl+D"),
            )?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(app, "clear", "Clear findings", true, None::<&str>)?,
            &MenuItem::with_id(
                app,
                "reload",
                "Reload passes and config",
                true,
                None::<&str>,
            )?,
        ],
    )?;

    // "+" is the macOS key equivalent for bigger text. It answers ⌘⇧= on a
    // US keyboard.
    let view = Submenu::with_items(
        app,
        "View",
        true,
        &[
            &MenuItem::with_id(app, "bigger", "Bigger text", true, Some("CmdOrCtrl++"))?,
            &MenuItem::with_id(app, "smaller", "Smaller text", true, Some("CmdOrCtrl+-"))?,
        ],
    )?;

    let window = Submenu::with_items(
        app,
        "Window",
        true,
        &[
            &PredefinedMenuItem::minimize(app, None)?,
            &PredefinedMenuItem::maximize(app, Some("Zoom"))?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::fullscreen(app, None)?,
        ],
    )?;

    Menu::with_items(app, &[&app_menu, &file, &edit, &view, &review, &window])
}

pub fn on_event<R: Runtime>(app: &AppHandle<R>, event: MenuEvent) {
    let id = event.id().as_ref().to_string();
    let _ = crate::log::write("info", &format!("menu: {id}"));

    if id == OPEN_HOME {
        let home = crate::config::home_dir();
        if let Err(e) = tauri_plugin_opener::open_path(&home, None::<&str>) {
            let _ = crate::log::write("error", &format!("cannot open {}: {e}", home.display()));
        }
        return;
    }

    if let Some(window) = app.get_webview_window("main") {
        let _ = window.emit(EVENT, id);
    }
}
