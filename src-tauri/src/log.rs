//! A log file. The app runs passes that take a minute each against a remote
//! provider, and when one of them goes wrong there is nowhere else to look:
//! the webview's console is not visible in a built app, and a failure that
//! never resolves leaves no trace at all.
//!
//! Lines are appended to `$WRITEGOOD_HOME/writegood.log` and the file is
//! trimmed when it gets large, because nobody will ever rotate it by hand.

use std::io::Write;

use crate::config;
use crate::error::AppResult;

const MAX_BYTES: u64 = 512 * 1024;

pub fn path() -> std::path::PathBuf {
    config::home_dir().join("writegood.log")
}

pub fn write(level: &str, message: &str) -> AppResult<()> {
    let path = path();
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir)?;
    }

    // Keep the tail rather than the head: the recent past is what matters.
    if std::fs::metadata(&path).map(|m| m.len()).unwrap_or(0) > MAX_BYTES {
        if let Ok(text) = std::fs::read_to_string(&path) {
            let keep: String = text
                .lines()
                .skip(text.lines().count() / 2)
                .map(|l| format!("{l}\n"))
                .collect();
            let _ = std::fs::write(&path, keep);
        }
    }

    let stamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);

    let mut file = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)?;
    writeln!(file, "{stamp} {level:<5} {message}")?;
    Ok(())
}

#[tauri::command]
pub fn app_log(level: String, message: String) -> AppResult<()> {
    write(&level, &message)
}

#[tauri::command]
pub fn log_path() -> String {
    path().to_string_lossy().into_owned()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::testing::env_home;

    #[test]
    fn appends_lines_with_a_level() {
        let _home = env_home("log");
        write("info", "first").unwrap();
        write("error", "second").unwrap();
        let text = std::fs::read_to_string(path()).unwrap();
        let lines: Vec<&str> = text.lines().collect();
        assert_eq!(lines.len(), 2);
        assert!(lines[0].contains("info"));
        assert!(lines[0].ends_with("first"));
        assert!(lines[1].contains("error"));
    }

    #[test]
    fn trims_itself_rather_than_growing_for_ever() {
        let _home = env_home("log-trim");
        let filler = "x".repeat(200);
        for _ in 0..4000 {
            write("info", &filler).unwrap();
        }
        let size = std::fs::metadata(path()).unwrap().len();
        assert!(size < MAX_BYTES * 2, "log grew to {size} bytes");
        // The newest line must survive the trim.
        write("info", "newest").unwrap();
        let text = std::fs::read_to_string(path()).unwrap();
        assert!(text.trim_end().ends_with("newest"));
    }
}
