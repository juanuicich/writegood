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

use tauri::menu::{
    AboutMetadata, Menu, MenuEvent, MenuItem, PredefinedMenuItem, Submenu, HELP_SUBMENU_ID,
};
use tauri::{AppHandle, Emitter, Manager, Runtime};

use crate::documents::Recent;

/// The event the webview listens for. Its payload is a palette command id.
const EVENT: &str = "menu-command";

/// Handled in Rust: Rust owns the filesystem, so Rust opens the folder.
const OPEN_HOME: &str = "open-home";

/// File > Open Recent, kept so it can be rebuilt. `Menu::get` finds only
/// top-level items, so the submenu is held here instead of looked up.
struct RecentMenu<R: Runtime>(Submenu<R>);

/// A recent item emits `open-doc:<id>`. It is not a palette command id: the
/// frontend opens that document (SPEC §6.3).
const OPEN_DOC: &str = "open-doc:";

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

    // Filled by refresh_recent once the frontend opens a document.
    let recent = Submenu::with_items(app, "Open Recent", true, &[])?;
    app.manage(RecentMenu(recent.clone()));

    let file = Submenu::with_items(
        app,
        "File",
        true,
        &[
            &MenuItem::with_id(app, "new", "New", true, Some("CmdOrCtrl+N"))?,
            &MenuItem::with_id(app, "open", "Open…", true, Some("CmdOrCtrl+O"))?,
            &recent,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(app, "save", "Save", true, Some("CmdOrCtrl+S"))?,
            &MenuItem::with_id(app, "save-as", "Save As…", true, Some("CmdOrCtrl+Shift+S"))?,
            &MenuItem::with_id(
                app,
                "major",
                "Save as major revision",
                true,
                Some("CmdOrCtrl+Alt+S"),
            )?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(app, OPEN_HOME, "Open the writegood folder", true, None::<&str>)?,
        ],
    )?;

    // Find and replace (SPEC §12.6). The page handles the same keys, so the
    // items only name them.
    let find = Submenu::with_items(
        app,
        "Find",
        true,
        &[
            &MenuItem::with_id(app, "find", "Find…", true, Some("CmdOrCtrl+F"))?,
            &MenuItem::with_id(app, "replace", "Find and Replace…", true, Some("CmdOrCtrl+Alt+F"))?,
            &MenuItem::with_id(app, "find-next", "Find Next", true, Some("CmdOrCtrl+G"))?,
            &MenuItem::with_id(app, "find-prev", "Find Previous", true, Some("CmdOrCtrl+Shift+G"))?,
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
            &PredefinedMenuItem::separator(app)?,
            &find,
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

    // ⌃⌘S is the macOS key for a sidebar, as in Finder, Mail and Notes.
    // "+" is the macOS key equivalent for bigger text. It answers ⌘⇧= on a
    // US keyboard. ⌘0 returns to the base size.
    let view = Submenu::with_items(
        app,
        "View",
        true,
        &[
            &MenuItem::with_id(app, "sidebar", "Show or hide the margin", true, Some("Ctrl+Cmd+S"))?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(app, "bigger", "Bigger text", true, Some("CmdOrCtrl++"))?,
            &MenuItem::with_id(app, "smaller", "Smaller text", true, Some("CmdOrCtrl+-"))?,
            &MenuItem::with_id(app, "actual-size", "Actual size", true, Some("CmdOrCtrl+0"))?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(app, "toggle-theme", "Switch light and dark", true, None::<&str>)?,
            &MenuItem::with_id(app, "theme", "Theme…", true, None::<&str>)?,
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

    // The help id makes macOS treat this as the Help menu. "?" is ⌘⇧/ on a US
    // keyboard.
    let help = Submenu::with_id_and_items(
        app,
        HELP_SUBMENU_ID,
        "Help",
        true,
        &[&MenuItem::with_id(app, "help", "writegood help", true, Some("CmdOrCtrl+Shift+/"))?],
    )?;

    Menu::with_items(app, &[&app_menu, &file, &edit, &view, &review, &window, &help])
}

/// Rebuild File > Open Recent. A failure is logged and leaves the old list:
/// the menu is a convenience, and the command bar has the same list.
pub fn refresh_recent<R: Runtime>(app: &AppHandle<R>, docs: &[Recent]) {
    let Some(state) = app.try_state::<RecentMenu<R>>() else { return };
    let menu = &state.0;
    let result = (|| -> tauri::Result<()> {
        for item in menu.items()? {
            menu.remove(&item)?;
        }
        if docs.is_empty() {
            menu.append(&MenuItem::new(app, "No recent documents", false, None::<&str>)?)?;
        }
        for doc in docs {
            let id = format!("{OPEN_DOC}{}", doc.id);
            menu.append(&MenuItem::with_id(app, id, &doc.title, true, None::<&str>)?)?;
        }
        Ok(())
    })();
    if let Err(e) = result {
        let _ = crate::log::write("warn", &format!("cannot rebuild Open Recent: {e}"));
    }
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
