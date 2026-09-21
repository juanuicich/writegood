//! The `~/.writegood` directory: layout, `config.toml`, and the pass library.
//!
//! `WRITEGOOD_HOME` overrides the home directory. Tests rely on it, and it lets
//! a user keep the whole state directory in git somewhere else.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::error::{AppError, AppResult};

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

/// Tests must never touch a real `~/.writegood`. An earlier run did exactly
/// that, because a test that had not yet set the override raced one that had.
/// Failing loudly is cheaper than cleaning up someone's drafts.
#[cfg(test)]
fn guard_test_home() {
    assert!(
        std::env::var_os("WRITEGOOD_HOME").is_some(),
        "a test reached home_dir() without setting WRITEGOOD_HOME"
    );
}

/// Test-only support for the modules that exercise the real path helpers.
/// `WRITEGOOD_HOME` is process-wide, so holding this guard is the only safe
/// way to set it.
#[cfg(test)]
pub(crate) mod testing {
    use std::path::PathBuf;
    use std::sync::{Mutex, MutexGuard};

    static LOCK: Mutex<()> = Mutex::new(());

    pub(crate) struct EnvHome {
        pub dir: PathBuf,
        _guard: MutexGuard<'static, ()>,
    }

    impl Drop for EnvHome {
        fn drop(&mut self) {
            std::env::remove_var("WRITEGOOD_HOME");
            let _ = std::fs::remove_dir_all(&self.dir);
        }
    }

    /// Point `WRITEGOOD_HOME` at a fresh temp directory for the life of the
    /// returned value. Serialised against every other caller.
    pub(crate) fn env_home(tag: &str) -> EnvHome {
        let guard = LOCK.lock().unwrap_or_else(|e| e.into_inner());
        let dir = std::env::temp_dir().join(format!("writegood-{tag}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        std::env::set_var("WRITEGOOD_HOME", &dir);
        EnvHome { dir, _guard: guard }
    }
}

/// `$WRITEGOOD_HOME`, else `~/.writegood`.
pub fn home_dir() -> PathBuf {
    #[cfg(test)]
    guard_test_home();

    home_from(std::env::var_os("WRITEGOOD_HOME"), std::env::var_os("HOME"))
}

/// The choice, without the environment, so it can be tested without setting a
/// process-wide variable.
fn home_from(over: Option<std::ffi::OsString>, home: Option<std::ffi::OsString>) -> PathBuf {
    if let Some(over) = over {
        if !over.is_empty() {
            return PathBuf::from(over);
        }
    }
    match home {
        Some(home) => PathBuf::from(home).join(".writegood"),
        // No HOME is not a case worth failing over; a relative path still works.
        None => PathBuf::from(".writegood"),
    }
}

pub fn config_path() -> PathBuf {
    home_dir().join("config.toml")
}

pub fn documents_dir() -> PathBuf {
    home_dir().join("documents")
}

pub fn passes_dir() -> PathBuf {
    home_dir().join("passes")
}

pub fn db_path() -> PathBuf {
    home_dir().join("writegood.db")
}

// ---------------------------------------------------------------------------
// Config types
//
// The structs carry camelCase names because the frontend reads them as JSON.
// Each multi-word field also accepts its snake_case spelling, because
// `config.toml` is hand-written in snake_case. Writing back out goes through
// the `wire` module below so the file keeps its snake_case keys.
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Config {
    #[serde(default = "default_provider_name", alias = "default_provider")]
    pub default_provider: String,
    #[serde(default, alias = "judge_provider")]
    pub judge_provider: Option<String>,
    #[serde(default)]
    pub rules: Rules,
    #[serde(default)]
    pub appearance: Appearance,
    #[serde(default)]
    pub providers: BTreeMap<String, Provider>,
}

fn default_provider_name() -> String {
    "anthropic".to_string()
}

impl Default for Config {
    fn default() -> Self {
        Config {
            default_provider: default_provider_name(),
            judge_provider: None,
            rules: Rules::default(),
            appearance: Appearance::default(),
            providers: BTreeMap::new(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Rules {
    #[serde(default, alias = "allow_suggestions")]
    pub allow_suggestions: bool,
    #[serde(default = "yes", alias = "redact_suggestions")]
    pub redact_suggestions: bool,
    #[serde(default = "yes", alias = "forbid_praise")]
    pub forbid_praise: bool,
    #[serde(default = "yes", alias = "blind_judge")]
    pub blind_judge: bool,
}

fn yes() -> bool {
    true
}

impl Default for Rules {
    fn default() -> Self {
        Rules {
            allow_suggestions: false,
            redact_suggestions: true,
            forbid_praise: true,
            blind_judge: true,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Appearance {
    #[serde(default = "default_font")]
    pub font: String,
    #[serde(default = "default_font_size", alias = "font_size")]
    pub font_size: u32,
    #[serde(default = "default_measure")]
    pub measure: u32,
    #[serde(default = "default_theme")]
    pub theme: String,
}

fn default_font() -> String {
    "Literata, ui-serif, Georgia, serif".to_string()
}
fn default_font_size() -> u32 {
    18
}
fn default_measure() -> u32 {
    68
}
fn default_theme() -> String {
    "light".to_string()
}

impl Default for Appearance {
    fn default() -> Self {
        Appearance {
            font: default_font(),
            font_size: default_font_size(),
            measure: default_measure(),
            theme: default_theme(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Provider {
    pub kind: String,
    #[serde(default)]
    pub model: Option<String>,
    #[serde(default, alias = "base_url")]
    pub base_url: Option<String>,
    #[serde(default, alias = "key_ref")]
    pub key_ref: Option<String>,
    #[serde(default)]
    pub command: Option<String>,
    #[serde(default)]
    pub args: Vec<String>,
    #[serde(default, alias = "json_path")]
    pub json_path: Option<String>,
    #[serde(default = "default_timeout", alias = "timeout_secs")]
    pub timeout_secs: u64,
}

fn default_timeout() -> u64 {
    180
}

impl Default for Provider {
    fn default() -> Self {
        Provider {
            kind: String::new(),
            model: None,
            base_url: None,
            key_ref: None,
            command: None,
            args: Vec::new(),
            json_path: None,
            timeout_secs: default_timeout(),
        }
    }
}

/// Serialisation-only mirrors that write snake_case keys back to `config.toml`.
mod wire {
    use super::{Appearance, Config, Provider, Rules};
    use serde::Serialize;
    use std::collections::BTreeMap;

    #[derive(Serialize)]
    pub struct WConfig<'a> {
        pub default_provider: &'a str,
        #[serde(skip_serializing_if = "Option::is_none")]
        pub judge_provider: Option<&'a str>,
        pub rules: WRules,
        pub appearance: WAppearance<'a>,
        pub providers: BTreeMap<&'a str, WProvider<'a>>,
    }

    #[derive(Serialize)]
    pub struct WRules {
        pub allow_suggestions: bool,
        pub redact_suggestions: bool,
        pub forbid_praise: bool,
        pub blind_judge: bool,
    }

    #[derive(Serialize)]
    pub struct WAppearance<'a> {
        pub font: &'a str,
        pub font_size: u32,
        pub measure: u32,
        pub theme: &'a str,
    }

    #[derive(Serialize)]
    pub struct WProvider<'a> {
        pub kind: &'a str,
        #[serde(skip_serializing_if = "Option::is_none")]
        pub model: Option<&'a str>,
        #[serde(skip_serializing_if = "Option::is_none")]
        pub base_url: Option<&'a str>,
        #[serde(skip_serializing_if = "Option::is_none")]
        pub key_ref: Option<&'a str>,
        #[serde(skip_serializing_if = "Option::is_none")]
        pub command: Option<&'a str>,
        #[serde(skip_serializing_if = "Vec::is_empty")]
        pub args: Vec<&'a str>,
        #[serde(skip_serializing_if = "Option::is_none")]
        pub json_path: Option<&'a str>,
        pub timeout_secs: u64,
    }

    pub fn borrow(cfg: &Config) -> WConfig<'_> {
        WConfig {
            default_provider: &cfg.default_provider,
            judge_provider: cfg.judge_provider.as_deref(),
            rules: rules(&cfg.rules),
            appearance: appearance(&cfg.appearance),
            providers: cfg
                .providers
                .iter()
                .map(|(name, p)| (name.as_str(), provider(p)))
                .collect(),
        }
    }

    fn rules(r: &Rules) -> WRules {
        WRules {
            allow_suggestions: r.allow_suggestions,
            redact_suggestions: r.redact_suggestions,
            forbid_praise: r.forbid_praise,
            blind_judge: r.blind_judge,
        }
    }

    fn appearance(a: &Appearance) -> WAppearance<'_> {
        WAppearance {
            font: &a.font,
            font_size: a.font_size,
            measure: a.measure,
            theme: &a.theme,
        }
    }

    fn provider(p: &Provider) -> WProvider<'_> {
        WProvider {
            kind: &p.kind,
            model: p.model.as_deref(),
            base_url: p.base_url.as_deref(),
            key_ref: p.key_ref.as_deref(),
            command: p.command.as_deref(),
            args: p.args.iter().map(String::as_str).collect(),
            json_path: p.json_path.as_deref(),
            timeout_secs: p.timeout_secs,
        }
    }
}

// ---------------------------------------------------------------------------
// Scaffold
// ---------------------------------------------------------------------------

/// The `config.toml` written on first run. It is the file from SPEC.md §9.1.
/// Only the anthropic provider is live; the rest stay commented so that opening
/// the file shows the format for each kind.
const DEFAULT_CONFIG: &str = r#"default_provider = "anthropic"
# judge_provider must differ from the pass provider, or the duel is worth less.
# judge_provider = "openai"

[rules]
# Rule One. Defaults keep the model's wording out of your draft entirely.
allow_suggestions   = false  # true adds a replacement field and an apply action
redact_suggestions  = true   # block wording that leaked into a note
# Rule Two.
forbid_praise       = true   # the no-encouragement preamble
blind_judge         = true   # shuffle A/B, strip history, require a second vendor

[appearance]
font        = "Literata, ui-serif, Georgia, serif"
font_size   = 18
measure     = 68             # characters per line
theme       = "light"        # light | dark | system

[providers.anthropic]
kind    = "anthropic"
model   = "claude-opus-5"
key_ref = "keychain:writegood/anthropic"

# [providers.openai]
# kind    = "openai"
# model   = "gpt-5.2"
# key_ref = "env:OPENAI_API_KEY"

# [providers.deepseek]
# kind     = "openai-compatible"
# base_url = "https://api.deepseek.com/v1"
# model    = "deepseek-flash"
# key_ref  = "env:DEEPSEEK_API_KEY"

# [providers.local]
# kind     = "openai-compatible"
# base_url = "http://localhost:11434/v1"
# model    = "qwen3:32b"

# [providers.claude-cli]
# kind    = "cli"
# command = "claude"
# args    = ["-p", "{prompt}", "--output-format", "json"]
# json_path = "result"        # extract this field from stdout, then parse
# timeout_secs = 180
"#;

/// The starter pass library from SPEC.md §8.2, as (file name, contents).
const STARTERS: &[(&str, &str)] = &[
    (
        "01-nominalization.md",
        r#"+++
# A starting point. Replace this prompt with your own wording.
name = "Buried verbs"
category = "nominalization"
scope = "paragraph"
enabled = true
+++

Find sentences where the action has been turned into a noun instead of being
carried by the verb. "Made a determination" for "determined". "Conducted an
investigation" for "investigated". "Is in agreement with" for "agrees".

Quote the phrase verbatim and name the verb that is buried inside the noun.
Do not write a corrected version of the sentence.
"#,
    ),
    (
        "02-passive-actor.md",
        r#"+++
# A starting point. Replace this prompt with your own wording.
name = "Missing actor"
category = "passive-actor"
scope = "paragraph"
enabled = true
+++

Find sentences whose grammatical subject is not the character doing the action.
Passive voice matters only when it hides who acted: "mistakes were made", "the
decision was taken". Passive voice with a stated actor, or used to keep the
topic steady across sentences, is not a problem.

Quote the clause verbatim and say which actor is missing or displaced.
Do not rewrite the clause.
"#,
    ),
    (
        "03-sentence-openings.md",
        r#"+++
# A starting point. Replace this prompt with your own wording.
name = "Sentence openings"
category = "sentence-openings"
scope = "paragraph"
enabled = true
+++

Look at how each sentence in this paragraph begins. Report two things: runs of
consecutive sentences that open with the same word or the same construction,
and long introductory phrases that delay the subject past about ten words.

Quote the opening words verbatim for each sentence you report.
Do not propose a different opening.
"#,
    ),
    (
        "04-filler-words.md",
        r#"+++
# A starting point. Replace this prompt with your own wording.
name = "Filler words"
category = "filler-words"
scope = "paragraph"
enabled = true
+++

Find words that add emphasis instead of meaning: very, really, actually,
basically, quite, truly, unfortunately, clearly, obviously, of course, it
should be noted that, it is important to remember.

Quote each one verbatim with enough of its sentence to locate it, and say what
the sentence asserts without it. Do not supply a shorter sentence.
"#,
    ),
    (
        "05-repeated-phrasing.md",
        r#"+++
# A starting point. Replace this prompt with your own wording.
name = "Repeated phrasing"
category = "repeated-phrasing"
scope = "paragraph"
enabled = true
+++

Find wording repeated close together where the repetition does no work:
the same uncommon noun, verb or adjective used twice within a few sentences,
a doubled pair that says one thing twice ("full and complete", "each and
every"), and clauses built on the same template.

Quote both occurrences verbatim. Do not offer a synonym or a merged sentence.
"#,
    ),
    (
        "06-paragraph-order.md",
        r#"+++
# A starting point. Replace this prompt with your own wording.
name = "Paragraph order"
category = "paragraph-order"
scope = "document"
enabled = true
+++

Read the draft as a sequence of paragraphs. Report paragraphs that arrive
before the reader has what they need to understand them, paragraphs that repeat
ground an earlier one already covered, and paragraphs that would carry the same
argument in a different position.

Quote the first sentence of each paragraph you report, verbatim, and say what
the ordering problem is. Do not propose an outline or a new order.
"#,
    ),
    (
        "07-topic-flow.md",
        r#"+++
# A starting point. Replace this prompt with your own wording.
name = "Topic flow"
category = "topic-flow"
scope = "document"
enabled = true
+++

Check whether each sentence opens with information the previous sentence
already established, and closes with what is new. Report sentences that open
with new, unfamiliar material, and stretches where the subject changes from
sentence to sentence with nothing connecting them.

Quote the opening of each sentence verbatim and name the break in the chain.
Do not rewrite the sentence or its neighbours.
"#,
    ),
    (
        "08-unearned-metaphor.md",
        r#"+++
# A starting point. Replace this prompt with your own wording.
name = "Unearned metaphor"
category = "unearned-metaphor"
scope = "paragraph"
enabled = true
+++

Find figurative language the draft has not earned: a metaphor that carries no
information the literal statement lacks, a metaphor that contradicts another one
nearby, and stock imagery used as a substitute for the argument.

Quote the figure verbatim and say what it claims that the plain statement does
not. Do not supply a better image or a literal restatement.
"#,
    ),
    (
        "09-length.md",
        r#"+++
# A starting point. Replace this prompt with your own wording.
name = "Length"
category = "length"
scope = "document"
enabled = true
+++

Assume this draft must lose a quarter of its words. Find the passages doing the
least work: material restating a point already made, qualification stacked on
qualification, examples that repeat the previous example's structure, and
throat-clearing before the sentence that carries the content.

Quote the opening of each passage verbatim and say why it is doing no work.
Do not produce a condensed version.
"#,
    ),
];

/// Create the directory layout and write the default files. Safe to call on
/// every startup; nothing already on disk is overwritten.
pub fn ensure_scaffold() -> AppResult<()> {
    ensure_scaffold_in(&home_dir())
}

/// The body of `ensure_scaffold`, against an explicit home. Every function
/// below has the same split: the public one reads the environment once, the
/// `_in` one does the work and is what the tests call.
fn ensure_scaffold_in(home: &Path) -> AppResult<()> {
    std::fs::create_dir_all(home)?;
    std::fs::create_dir_all(home.join("documents"))?;
    let passes = home.join("passes");
    std::fs::create_dir_all(&passes)?;

    let cfg = home.join("config.toml");
    if !cfg.exists() {
        std::fs::write(&cfg, DEFAULT_CONFIG)?;
    }

    for (name, body) in STARTERS {
        let path = passes.join(name);
        if !path.exists() {
            std::fs::write(&path, body)?;
        }
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// Load and save
// ---------------------------------------------------------------------------

pub fn load_config() -> AppResult<Config> {
    load_config_in(&home_dir())
}

fn load_config_in(home: &Path) -> AppResult<Config> {
    ensure_scaffold_in(home)?;
    let text = std::fs::read_to_string(home.join("config.toml"))?;
    Ok(toml::from_str(&text)?)
}

pub fn save_config(cfg: &Config) -> AppResult<()> {
    save_config_in(&home_dir(), cfg)
}

fn save_config_in(home: &Path, cfg: &Config) -> AppResult<()> {
    ensure_scaffold_in(home)?;
    let text = toml::to_string_pretty(&wire::borrow(cfg))
        .map_err(|e| AppError::other(format!("cannot write config: {e}")))?;
    std::fs::write(home.join("config.toml"), text)?;
    Ok(())
}

// ---------------------------------------------------------------------------
// Passes
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Pass {
    pub slug: String,
    pub name: String,
    pub category: String,
    pub scope: String,
    pub provider: Option<String>,
    pub enabled: bool,
    pub prompt: String,
    pub path: String,
}

/// The frontmatter as it appears in the file. TOML is snake_case throughout,
/// so no aliases are needed here.
#[derive(Deserialize)]
struct Frontmatter {
    name: Option<String>,
    category: Option<String>,
    #[serde(default = "default_scope")]
    scope: String,
    provider: Option<String>,
    #[serde(default = "yes")]
    enabled: bool,
}

fn default_scope() -> String {
    "paragraph".to_string()
}

/// Every `*.md` in the passes directory, ordered by file name.
pub fn load_passes() -> AppResult<Vec<Pass>> {
    load_passes_in(&home_dir())
}

fn load_passes_in(home: &Path) -> AppResult<Vec<Pass>> {
    ensure_scaffold_in(home)?;
    let dir = home.join("passes");
    let mut files: Vec<PathBuf> = Vec::new();
    for entry in std::fs::read_dir(&dir)? {
        let path = entry?.path();
        if path.extension().and_then(|e| e.to_str()) == Some("md") {
            files.push(path);
        }
    }
    files.sort();

    let mut passes = Vec::with_capacity(files.len());
    for path in files {
        let text = std::fs::read_to_string(&path)?;
        passes.push(parse_pass(&path, &text)?);
    }
    Ok(passes)
}

/// Split one pass file into frontmatter and prompt. A file that does not parse
/// is an error naming the file, so a typo in a prompt is visible rather than
/// silently dropping the pass.
fn parse_pass(path: &Path, text: &str) -> AppResult<Pass> {
    let file_name = path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("<unnamed>")
        .to_string();

    let body = text.strip_prefix('\u{feff}').unwrap_or(text);
    let mut lines = body.lines();
    let opening = lines.next().map(str::trim_end).unwrap_or("");
    if opening != "+++" {
        return Err(AppError::invalid(format!(
            "{file_name}: the file must start with a line of exactly +++"
        )));
    }

    let mut front = String::new();
    let mut closed = false;
    for line in lines.by_ref() {
        if line.trim_end() == "+++" {
            closed = true;
            break;
        }
        front.push_str(line);
        front.push('\n');
    }
    if !closed {
        return Err(AppError::invalid(format!(
            "{file_name}: the frontmatter has no closing +++"
        )));
    }

    let fm: Frontmatter = toml::from_str(&front)
        .map_err(|e| AppError::invalid(format!("{file_name}: bad frontmatter: {e}")))?;

    let prompt: String = {
        let rest: Vec<&str> = lines.collect();
        rest.join("\n").trim().to_string()
    };

    let stem = path
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or(&file_name);
    let slug = slug_from_stem(stem);

    let name = fm
        .name
        .ok_or_else(|| AppError::invalid(format!("{file_name}: the frontmatter needs a name")))?;

    Ok(Pass {
        category: fm.category.unwrap_or_else(|| slug.clone()),
        slug,
        name,
        scope: fm.scope,
        provider: fm.provider,
        enabled: fm.enabled,
        prompt,
        path: path.to_string_lossy().into_owned(),
    })
}

/// `01-nominalization` becomes `nominalization`. The number is ordering only.
fn slug_from_stem(stem: &str) -> String {
    let trimmed = stem.trim_start_matches(|c: char| c.is_ascii_digit() || c == '-');
    if trimmed.is_empty() {
        stem.to_string()
    } else {
        trimmed.to_string()
    }
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Paths {
    pub home: String,
    pub config: String,
    pub documents: String,
    pub passes: String,
    pub db: String,
}

#[tauri::command]
pub fn config_load() -> AppResult<Config> {
    load_config()
}

#[tauri::command]
pub fn config_save(config: Config) -> AppResult<()> {
    save_config(&config)
}

#[tauri::command]
pub fn config_paths() -> AppResult<Paths> {
    ensure_scaffold()?;
    let s = |p: PathBuf| p.to_string_lossy().into_owned();
    Ok(Paths {
        home: s(home_dir()),
        config: s(config_path()),
        documents: s(documents_dir()),
        passes: s(passes_dir()),
        db: s(db_path()),
    })
}

#[tauri::command]
pub fn passes_list() -> AppResult<Vec<Pass>> {
    load_passes()
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicU32, Ordering};

    /// A unique directory standing in for the home. Tests call the `_in`
    /// functions with it rather than setting `WRITEGOOD_HOME`, because the
    /// environment is process-wide and other test modules write to it too.
    struct TempHome(PathBuf);

    impl TempHome {
        fn new() -> Self {
            static N: AtomicU32 = AtomicU32::new(0);
            let n = N.fetch_add(1, Ordering::SeqCst);
            let path =
                std::env::temp_dir().join(format!("writegood-config-{}-{n}", std::process::id()));
            let _ = std::fs::remove_dir_all(&path);
            TempHome(path)
        }
        fn at(&self) -> &Path {
            &self.0
        }
    }

    impl Drop for TempHome {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    fn the_override_wins_over_the_real_home() {
        use std::ffi::OsString;
        assert_eq!(
            home_from(
                Some(OsString::from("/tmp/elsewhere")),
                Some(OsString::from("/Users/x"))
            ),
            PathBuf::from("/tmp/elsewhere")
        );
        assert_eq!(
            home_from(Some(OsString::new()), Some(OsString::from("/Users/x"))),
            PathBuf::from("/Users/x/.writegood")
        );
        assert_eq!(
            home_from(None, Some(OsString::from("/Users/x"))),
            PathBuf::from("/Users/x/.writegood")
        );
        assert_eq!(home_from(None, None), PathBuf::from(".writegood"));
    }

    #[test]
    fn the_paths_hang_off_the_home() {
        let _env = super::testing::env_home("paths");
        let home = home_dir();
        assert_eq!(config_path(), home.join("config.toml"));
        assert_eq!(documents_dir(), home.join("documents"));
        assert_eq!(passes_dir(), home.join("passes"));
        assert_eq!(db_path(), home.join("writegood.db"));
    }

    #[test]
    fn scaffold_is_idempotent() {
        let home = TempHome::new();
        ensure_scaffold_in(home.at()).unwrap();
        // A hand edit must survive the next startup.
        std::fs::write(
            home.at().join("config.toml"),
            "default_provider = \"local\"\n",
        )
        .unwrap();
        std::fs::write(
            home.at().join("passes").join("01-nominalization.md"),
            "+++\nname = \"Mine\"\n+++\nbody",
        )
        .unwrap();
        ensure_scaffold_in(home.at()).unwrap();

        let cfg = load_config_in(home.at()).unwrap();
        assert_eq!(cfg.default_provider, "local");
        let passes = load_passes_in(home.at()).unwrap();
        assert_eq!(passes.len(), STARTERS.len());
        assert_eq!(passes[0].name, "Mine");
        assert!(home.at().join("documents").is_dir());
    }

    #[test]
    fn defaults_apply_to_a_partial_file() {
        let home = TempHome::new();
        ensure_scaffold_in(home.at()).unwrap();
        std::fs::write(
            home.at().join("config.toml"),
            "default_provider = \"openai\"\n",
        )
        .unwrap();

        let cfg = load_config_in(home.at()).unwrap();
        assert_eq!(cfg.default_provider, "openai");
        assert_eq!(cfg.judge_provider, None);
        assert!(!cfg.rules.allow_suggestions);
        assert!(cfg.rules.redact_suggestions);
        assert!(cfg.rules.forbid_praise);
        assert!(cfg.rules.blind_judge);
        assert_eq!(cfg.appearance.font, default_font());
        assert_eq!(cfg.appearance.font_size, default_font_size());
        assert_eq!(cfg.appearance.measure, 68);
        assert_eq!(cfg.appearance.theme, "light");
        assert!(cfg.providers.is_empty());
    }

    #[test]
    fn an_empty_file_gives_the_defaults() {
        let cfg: Config = toml::from_str("").unwrap();
        assert_eq!(cfg.default_provider, "anthropic");
        assert!(cfg.rules.blind_judge);
        assert_eq!(cfg.appearance.measure, 68);
    }

    #[test]
    fn the_default_file_parses() {
        let cfg: Config = toml::from_str(DEFAULT_CONFIG).unwrap();
        assert_eq!(cfg.default_provider, "anthropic");
        let anthropic = cfg.providers.get("anthropic").unwrap();
        assert_eq!(anthropic.kind, "anthropic");
        assert_eq!(
            anthropic.key_ref.as_deref(),
            Some("keychain:writegood/anthropic")
        );
        assert_eq!(anthropic.timeout_secs, 180);
        // Only anthropic is live; the rest of §9.1 stays commented out.
        assert_eq!(cfg.providers.len(), 1);
    }

    #[test]
    fn the_spec_example_parses_with_every_provider_kind() {
        let text = r#"
default_provider = "anthropic"
judge_provider   = "openai"

[providers.local]
kind     = "openai-compatible"
base_url = "http://localhost:11434/v1"
model    = "qwen3:32b"

[providers.claude-cli]
kind    = "cli"
command = "claude"
args    = ["-p", "{prompt}", "--output-format", "json"]
json_path = "result"
timeout_secs = 90
"#;
        let cfg: Config = toml::from_str(text).unwrap();
        assert_eq!(cfg.judge_provider.as_deref(), Some("openai"));
        let local = cfg.providers.get("local").unwrap();
        assert_eq!(local.base_url.as_deref(), Some("http://localhost:11434/v1"));
        assert_eq!(local.timeout_secs, 180);
        let cli = cfg.providers.get("claude-cli").unwrap();
        assert_eq!(cli.command.as_deref(), Some("claude"));
        assert_eq!(cli.args.len(), 4);
        assert_eq!(cli.json_path.as_deref(), Some("result"));
        assert_eq!(cli.timeout_secs, 90);
    }

    #[test]
    fn saving_writes_snake_case_and_reloads() {
        let home = TempHome::new();
        ensure_scaffold_in(home.at()).unwrap();

        let mut cfg = load_config_in(home.at()).unwrap();
        cfg.judge_provider = Some("openai".into());
        cfg.appearance.font_size = 21;
        cfg.rules.allow_suggestions = true;
        cfg.providers.insert(
            "claude-cli".into(),
            Provider {
                kind: "cli".into(),
                command: Some("claude".into()),
                args: vec!["-p".into(), "{prompt}".into()],
                json_path: Some("result".into()),
                timeout_secs: 90,
                ..Provider::default()
            },
        );
        save_config_in(home.at(), &cfg).unwrap();

        let text = std::fs::read_to_string(home.at().join("config.toml")).unwrap();
        assert!(text.contains("default_provider"));
        assert!(text.contains("font_size"));
        assert!(text.contains("allow_suggestions"));
        assert!(text.contains("timeout_secs"));
        assert!(!text.contains("fontSize"));

        let back = load_config_in(home.at()).unwrap();
        assert_eq!(back.judge_provider.as_deref(), Some("openai"));
        assert_eq!(back.appearance.font_size, 21);
        assert!(back.rules.allow_suggestions);
        assert_eq!(back.providers["claude-cli"].timeout_secs, 90);
        assert_eq!(
            back.providers["anthropic"].model.as_deref(),
            Some("claude-opus-5")
        );
    }

    #[test]
    fn config_serialises_to_camel_case_json() {
        let cfg = Config::default();
        let json = serde_json::to_string(&cfg).unwrap();
        assert!(json.contains("\"defaultProvider\""));
        assert!(json.contains("\"redactSuggestions\""));
        assert!(json.contains("\"fontSize\""));
    }

    #[test]
    fn a_pass_serialises_to_camel_case_json() {
        let pass = parse_pass(
            Path::new("/tmp/01-nominalization.md"),
            "+++\nname = \"x\"\n+++\nbody\n",
        )
        .unwrap();
        let json = serde_json::to_string(&pass).unwrap();
        assert!(json.contains("\"slug\""));
        assert!(json.contains("\"prompt\""));
    }

    #[test]
    fn frontmatter_parses() {
        let text = "+++\nname = \"Buried verbs\"\ncategory = \"nominalization\"\nscope = \"paragraph\"\nprovider = \"anthropic\"\nenabled = true\n+++\n\n  prompt body  \n";
        let pass = parse_pass(Path::new("/tmp/01-nominalization.md"), text).unwrap();
        assert_eq!(pass.slug, "nominalization");
        assert_eq!(pass.name, "Buried verbs");
        assert_eq!(pass.category, "nominalization");
        assert_eq!(pass.scope, "paragraph");
        assert_eq!(pass.provider.as_deref(), Some("anthropic"));
        assert!(pass.enabled);
        assert_eq!(pass.prompt, "prompt body");
        assert_eq!(pass.path, "/tmp/01-nominalization.md");
    }

    #[test]
    fn frontmatter_defaults_fill_in() {
        let text = "+++\nname = \"Only a name\"\n+++\nbody\n";
        let pass = parse_pass(Path::new("/tmp/07-topic-flow.md"), text).unwrap();
        assert_eq!(pass.slug, "topic-flow");
        assert_eq!(pass.category, "topic-flow");
        assert_eq!(pass.scope, "paragraph");
        assert_eq!(pass.provider, None);
        assert!(pass.enabled);
    }

    #[test]
    fn a_disabled_pass_stays_disabled() {
        let text = "+++\nname = \"x\"\nenabled = false\n+++\nbody\n";
        let pass = parse_pass(Path::new("/tmp/01-x.md"), text).unwrap();
        assert!(!pass.enabled);
    }

    #[test]
    fn a_prompt_may_contain_plus_lines() {
        let text = "+++\nname = \"Plus\"\n+++\nfirst\n+++\nsecond\n";
        let pass = parse_pass(Path::new("/tmp/01-plus.md"), text).unwrap();
        assert_eq!(pass.prompt, "first\n+++\nsecond");
    }

    #[test]
    fn missing_frontmatter_is_an_error_naming_the_file() {
        let err = parse_pass(Path::new("/tmp/05-broken.md"), "just a prompt\n").unwrap_err();
        let msg = err.to_string();
        assert!(msg.contains("05-broken.md"), "{msg}");
        assert!(msg.contains("+++"), "{msg}");
    }

    #[test]
    fn unclosed_frontmatter_is_an_error() {
        let err =
            parse_pass(Path::new("/tmp/05-broken.md"), "+++\nname = \"x\"\nbody\n").unwrap_err();
        assert!(err.to_string().contains("closing +++"));
    }

    #[test]
    fn malformed_toml_is_an_error_naming_the_file() {
        let err =
            parse_pass(Path::new("/tmp/05-broken.md"), "+++\nname = \n+++\nbody\n").unwrap_err();
        let msg = err.to_string();
        assert!(msg.contains("05-broken.md"), "{msg}");
        assert!(msg.contains("bad frontmatter"), "{msg}");
    }

    #[test]
    fn a_pass_without_a_name_is_an_error() {
        let err = parse_pass(
            Path::new("/tmp/05-broken.md"),
            "+++\ncategory = \"x\"\n+++\nbody\n",
        )
        .unwrap_err();
        assert!(err.to_string().contains("needs a name"));
    }

    #[test]
    fn slugs_strip_leading_digits_and_dashes() {
        assert_eq!(slug_from_stem("01-nominalization"), "nominalization");
        assert_eq!(slug_from_stem("123--passive-actor"), "passive-actor");
        assert_eq!(slug_from_stem("length"), "length");
        assert_eq!(slug_from_stem("2026-01-02"), "2026-01-02");
    }

    #[test]
    fn the_starter_passes_load() {
        let home = TempHome::new();
        let passes = load_passes_in(home.at()).unwrap();
        assert_eq!(passes.len(), 9);
        let slugs: Vec<&str> = passes.iter().map(|p| p.slug.as_str()).collect();
        assert_eq!(
            slugs,
            vec![
                "nominalization",
                "passive-actor",
                "sentence-openings",
                "filler-words",
                "repeated-phrasing",
                "paragraph-order",
                "topic-flow",
                "unearned-metaphor",
                "length",
            ]
        );
        for p in &passes {
            assert!(p.enabled);
            assert!(!p.prompt.is_empty(), "{} has no prompt", p.slug);
            assert!(
                !p.prompt.contains("starting point"),
                "the marker belongs in the frontmatter, not the prompt"
            );
            // Rule One and Rule Two, enforced in the shipped prompts.
            let lower = p.prompt.to_lowercase();
            assert!(
                lower.contains("verbatim"),
                "{} does not ask for verbatim quotes",
                p.slug
            );
            assert!(
                lower.contains("do not"),
                "{} does not forbid rewriting",
                p.slug
            );
        }
        let doc_scoped: Vec<&str> = passes
            .iter()
            .filter(|p| p.scope == "document")
            .map(|p| p.slug.as_str())
            .collect();
        assert_eq!(doc_scoped, vec!["paragraph-order", "topic-flow", "length"]);
    }

    #[test]
    fn every_starter_carries_the_replace_me_comment() {
        for (name, body) in STARTERS {
            assert!(
                body.contains("# A starting point."),
                "{name} has no starting-point comment"
            );
        }
    }

    #[test]
    fn a_non_markdown_file_in_the_passes_directory_is_ignored() {
        let home = TempHome::new();
        ensure_scaffold_in(home.at()).unwrap();
        std::fs::write(home.at().join("passes").join("README.txt"), "notes").unwrap();
        assert_eq!(load_passes_in(home.at()).unwrap().len(), 9);
    }
}
