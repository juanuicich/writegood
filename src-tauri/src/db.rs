//! SQLite storage. Single user, single process, so one connection behind a
//! mutex is enough and keeps every write serialised.

use rusqlite::{params, Connection, OptionalExtension, Row};
use serde::{Deserialize, Serialize};
use std::path::Path;
use std::sync::Mutex;

use crate::error::{AppError, AppResult};

pub struct Db(pub Mutex<Connection>);

const SCHEMA: &str = r#"
pragma journal_mode = wal;
pragma foreign_keys = on;

create table if not exists documents (
    id          integer primary key,
    path        text    unique,
    title       text    not null,
    created_at  text    not null default (datetime('now')),
    updated_at  text    not null default (datetime('now')),
    opened_at   text
);

create table if not exists revisions (
    id           integer primary key,
    doc_id       integer not null references documents(id) on delete cascade,
    parent_id    integer references revisions(id),
    content_json text    not null,
    content_text text    not null,
    major        integer not null default 0,
    label        text,
    created_at   text    not null default (datetime('now'))
);
create index if not exists revisions_doc on revisions(doc_id, id desc);

create table if not exists runs (
    id          integer primary key,
    doc_id      integer not null references documents(id) on delete cascade,
    revision_id integer not null references revisions(id) on delete cascade,
    pass_slug   text    not null,
    pass_name   text    not null,
    provider    text    not null,
    model       text,
    status      text    not null default 'running',
    error       text,
    started_at  text    not null default (datetime('now')),
    finished_at text,
    input_tokens  integer,
    output_tokens integer,
    cost_usd      real
);
create index if not exists runs_doc on runs(doc_id, id desc);

create table if not exists findings (
    id         integer primary key,
    run_id     integer not null references runs(id) on delete cascade,
    doc_id     integer not null references documents(id) on delete cascade,
    category   text    not null,
    severity   text    not null default 'medium',
    note       text    not null,
    quote      text    not null,
    prefix     text    not null default '',
    suffix     text    not null default '',
    status     text    not null default 'open',
    created_at text    not null default (datetime('now'))
);
create index if not exists findings_doc on findings(doc_id, status);

create table if not exists duels (
    id             integer primary key,
    doc_id         integer not null references documents(id) on delete cascade,
    finding_id     integer references findings(id) on delete set null,
    a_text         text    not null,
    b_text         text    not null,
    a_is_original  integer not null,
    judge_provider text    not null,
    judge_model    text,
    verdict        text,
    original_won   integer,
    reason         text,
    created_at     text    not null default (datetime('now')),
    input_tokens   integer,
    output_tokens  integer,
    cost_usd       real
);
create index if not exists duels_doc on duels(doc_id, id desc);
"#;

pub fn open(path: &Path) -> AppResult<Connection> {
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir)?;
    }
    let conn = Connection::open(path)?;
    conn.execute_batch(SCHEMA)?;
    migrate(&conn)?;
    recover_orphaned_runs(&conn)?;
    Ok(conn)
}

/// Columns added after the first release. `create table if not exists` leaves
/// an existing table as it was, so a database made before a column existed
/// gains it here. Rows it already holds read null, which the app shows as
/// "not recorded" rather than zero.
const ADDED: &[(&str, &str, &str)] = &[
    ("runs", "input_tokens", "integer"),
    ("runs", "output_tokens", "integer"),
    ("runs", "cost_usd", "real"),
    ("duels", "input_tokens", "integer"),
    ("duels", "output_tokens", "integer"),
    ("duels", "cost_usd", "real"),
];

fn migrate(conn: &Connection) -> AppResult<()> {
    let paths_required = conn
        .prepare("pragma table_info(documents)")?
        .query_map([], |row| Ok((row.get::<_, String>("name")?, row.get::<_, i64>("notnull")?)))?
        .collect::<rusqlite::Result<Vec<_>>>()?
        .iter()
        .any(|(name, notnull)| name == "path" && *notnull != 0);
    if paths_required {
        rebuild_documents(conn)?;
    }

    for (table, column, kind) in ADDED {
        let mut stmt = conn.prepare(&format!("pragma table_info({table})"))?;
        let present = stmt
            .query_map([], |row| row.get::<_, String>("name"))?
            .collect::<rusqlite::Result<Vec<_>>>()?
            .iter()
            .any(|name| name == column);
        if !present {
            conn.execute_batch(&format!("alter table {table} add column {column} {kind}"))?;
        }
    }
    Ok(())
}

/// Before files could live anywhere, every document had a path. An untitled
/// draft has none (SPEC §6.3), and SQLite cannot drop `not null` in place, so
/// the table is rebuilt. Ids are copied, so revisions and findings stay
/// attached. Foreign keys are off while the old table is dropped, or the
/// drop would cascade into every row that points at it.
fn rebuild_documents(conn: &Connection) -> AppResult<()> {
    conn.execute_batch("pragma foreign_keys = off")?;
    let result = conn.execute_batch(
        "begin;
         create table documents_new (
             id          integer primary key,
             path        text    unique,
             title       text    not null,
             created_at  text    not null default (datetime('now')),
             updated_at  text    not null default (datetime('now')),
             opened_at   text
         );
         insert into documents_new (id, path, title, created_at, updated_at, opened_at)
              select id, path, title, created_at, updated_at, updated_at from documents;
         drop table documents;
         alter table documents_new rename to documents;
         commit;",
    );
    if result.is_err() {
        let _ = conn.execute_batch("rollback");
    }
    conn.execute_batch("pragma foreign_keys = on")?;
    Ok(result?)
}

/// A run is marked finished by the frontend. If the app stops first — a crash,
/// a quit, a reload during development — the row is left at `running` and
/// nothing will ever close it. Close them at startup so the history says what
/// happened instead of lying about work still in progress.
pub fn recover_orphaned_runs(conn: &Connection) -> AppResult<usize> {
    let n = conn.execute(
        "update runs
            set status = 'interrupted',
                finished_at = datetime('now'),
                error = 'the app stopped before this run finished'
          where status = 'running'",
        [],
    )?;
    Ok(n)
}

// ---------------------------------------------------------------- documents

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Document {
    pub id: i64,
    /// Absolute path of the Markdown file. The file is the document; this row
    /// only exists so findings and revisions have something to hang from.
    /// None for an untitled draft, which lives in a recovery file until it is
    /// first saved (SPEC §6.3).
    pub path: Option<String>,
    pub title: String,
    pub created_at: String,
    pub updated_at: String,
    /// When the author last opened it. Orders the recent list.
    pub opened_at: Option<String>,
}

fn document_from_row(row: &Row) -> rusqlite::Result<Document> {
    Ok(Document {
        id: row.get("id")?,
        path: row.get("path")?,
        title: row.get("title")?,
        created_at: row.get("created_at")?,
        updated_at: row.get("updated_at")?,
        opened_at: row.get("opened_at")?,
    })
}

pub fn list_documents(conn: &Connection) -> AppResult<Vec<Document>> {
    let mut stmt = conn.prepare("select * from documents order by updated_at desc, id desc")?;
    let rows = stmt.query_map([], document_from_row)?;
    Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
}

/// Register a Markdown file, or update the cached title of one already known.
pub fn upsert_document(conn: &Connection, path: &str, title: &str) -> AppResult<Document> {
    conn.execute(
        "insert into documents (path, title) values (?1, ?2)
         on conflict(path) do update set title = ?2, updated_at = datetime('now')",
        params![path, title],
    )?;
    get_document_by_path(conn, path)
}

pub fn get_document_by_path(conn: &Connection, path: &str) -> AppResult<Document> {
    let mut stmt = conn.prepare("select * from documents where path = ?1")?;
    stmt.query_row(params![path], document_from_row)
        .optional()?
        .ok_or(AppError::NotFound("document"))
}

/// A draft with no file yet. It has a row from the start, so passes,
/// findings and revisions work on it before it is saved.
pub fn create_untitled(conn: &Connection, title: &str) -> AppResult<Document> {
    conn.execute("insert into documents (path, title) values (null, ?1)", params![title])?;
    get_document(conn, conn.last_insert_rowid())
}

/// Record that the author opened a document, for the recent list.
pub fn touch_opened(conn: &Connection, id: i64) -> AppResult<()> {
    conn.execute(
        "update documents set opened_at = strftime('%Y-%m-%d %H:%M:%f', 'now') where id = ?1",
        params![id],
    )?;
    Ok(())
}

/// Every document the author has opened, most recent first. Whether its file
/// still exists is the caller's question: this module does no file IO.
pub fn opened_documents(conn: &Connection) -> AppResult<Vec<Document>> {
    let mut stmt = conn.prepare(
        "select * from documents where opened_at is not null order by opened_at desc, id desc",
    )?;
    let rows = stmt.query_map([], document_from_row)?;
    Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
}

/// Point a row at a new file: the first save of an untitled draft, or Save
/// As. The history goes with it. A path that another row holds is refused,
/// because two rows cannot share a file.
pub fn move_document(conn: &Connection, id: i64, path: &str, title: &str) -> AppResult<Document> {
    if let Ok(other) = get_document_by_path(conn, path) {
        if other.id != id {
            return Err(AppError::invalid(format!(
                "{path} is already open as another document. Choose another name."
            )));
        }
    }
    conn.execute(
        "update documents set path = ?2, title = ?3, updated_at = datetime('now') where id = ?1",
        params![id, path, title],
    )?;
    get_document(conn, id)
}

pub fn get_document(conn: &Connection, id: i64) -> AppResult<Document> {
    let mut stmt = conn.prepare("select * from documents where id = ?1")?;
    stmt.query_row(params![id], document_from_row)
        .optional()?
        .ok_or(AppError::NotFound("document"))
}

pub fn rename_document(conn: &Connection, id: i64, title: &str) -> AppResult<()> {
    conn.execute(
        "update documents set title = ?2, updated_at = datetime('now') where id = ?1",
        params![id, title],
    )?;
    Ok(())
}

pub fn delete_document(conn: &Connection, id: i64) -> AppResult<()> {
    conn.execute("delete from documents where id = ?1", params![id])?;
    Ok(())
}

// ---------------------------------------------------------------- revisions

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Revision {
    pub id: i64,
    pub doc_id: i64,
    pub parent_id: Option<i64>,
    pub content_json: String,
    pub content_text: String,
    pub major: bool,
    pub label: Option<String>,
    pub created_at: String,
}

fn revision_from_row(row: &Row) -> rusqlite::Result<Revision> {
    Ok(Revision {
        id: row.get("id")?,
        doc_id: row.get("doc_id")?,
        parent_id: row.get("parent_id")?,
        content_json: row.get("content_json")?,
        content_text: row.get("content_text")?,
        major: row.get::<_, i64>("major")? != 0,
        label: row.get("label")?,
        created_at: row.get("created_at")?,
    })
}

/// Save a revision. Consecutive minor saves collapse into the newest one, so
/// ordinary typing does not bury the revisions the author actually marked.
pub fn save_revision(
    conn: &Connection,
    doc_id: i64,
    content_json: &str,
    content_text: &str,
    major: bool,
    label: Option<&str>,
) -> AppResult<Revision> {
    let latest = latest_revision(conn, doc_id)?;

    if !major {
        if let Some(prev) = &latest {
            if !prev.major {
                conn.execute(
                    "update revisions set content_json = ?2, content_text = ?3, created_at = datetime('now') where id = ?1",
                    params![prev.id, content_json, content_text],
                )?;
                touch_document(conn, doc_id)?;
                return get_revision(conn, prev.id);
            }
        }
    }

    conn.execute(
        "insert into revisions (doc_id, parent_id, content_json, content_text, major, label)
         values (?1, ?2, ?3, ?4, ?5, ?6)",
        params![doc_id, latest.map(|r| r.id), content_json, content_text, major as i64, label],
    )?;
    touch_document(conn, doc_id)?;
    get_revision(conn, conn.last_insert_rowid())
}

fn touch_document(conn: &Connection, doc_id: i64) -> AppResult<()> {
    conn.execute(
        "update documents set updated_at = datetime('now') where id = ?1",
        params![doc_id],
    )?;
    Ok(())
}

pub fn get_revision(conn: &Connection, id: i64) -> AppResult<Revision> {
    let mut stmt = conn.prepare("select * from revisions where id = ?1")?;
    stmt.query_row(params![id], revision_from_row)
        .optional()?
        .ok_or(AppError::NotFound("revision"))
}

pub fn latest_revision(conn: &Connection, doc_id: i64) -> AppResult<Option<Revision>> {
    let mut stmt =
        conn.prepare("select * from revisions where doc_id = ?1 order by id desc limit 1")?;
    Ok(stmt.query_row(params![doc_id], revision_from_row).optional()?)
}

pub fn list_revisions(conn: &Connection, doc_id: i64) -> AppResult<Vec<Revision>> {
    let mut stmt = conn.prepare("select * from revisions where doc_id = ?1 order by id desc")?;
    let rows = stmt.query_map(params![doc_id], revision_from_row)?;
    Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
}

pub fn flag_revision(conn: &Connection, id: i64, major: bool, label: Option<&str>) -> AppResult<()> {
    conn.execute(
        "update revisions set major = ?2, label = ?3 where id = ?1",
        params![id, major as i64, label],
    )?;
    Ok(())
}

// -------------------------------------------------------------------- usage

/// What a run or a duel used, summed over its calls (SPEC §9.4). Each field is
/// null when nothing was reported: a CLI call has no tokens, and a model the
/// price catalog does not know has tokens but no cost.
#[derive(Debug, Default, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Usage {
    pub input_tokens: Option<i64>,
    pub output_tokens: Option<i64>,
    pub cost_usd: Option<f64>,
}

fn usage_from_row(row: &Row) -> rusqlite::Result<Usage> {
    Ok(Usage {
        input_tokens: row.get("input_tokens")?,
        output_tokens: row.get("output_tokens")?,
        cost_usd: row.get("cost_usd")?,
    })
}

/// One file's running total across its runs and duels.
///
/// `cost_usd` adds up only the rows that carry a price. `unpriced_tokens`
/// counts the tokens of rows that do not, so the display can say how much of
/// the usage the dollar figure leaves out instead of hiding it.
#[derive(Debug, Default, Clone, Copy, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DocUsage {
    pub cost_usd: f64,
    pub priced_calls: i64,
    pub unpriced_tokens: i64,
}

pub fn doc_usage(conn: &Connection, doc_id: i64) -> AppResult<DocUsage> {
    let sql = "select
                 coalesce(sum(cost_usd), 0.0),
                 count(cost_usd),
                 coalesce(sum(case when cost_usd is null
                                   then coalesce(input_tokens, 0) + coalesce(output_tokens, 0)
                              end), 0)
               from (select cost_usd, input_tokens, output_tokens from runs where doc_id = ?1
                     union all
                     select cost_usd, input_tokens, output_tokens from duels where doc_id = ?1)";
    Ok(conn.query_row(sql, params![doc_id], |row| {
        Ok(DocUsage {
            cost_usd: row.get(0)?,
            priced_calls: row.get(1)?,
            unpriced_tokens: row.get(2)?,
        })
    })?)
}

// --------------------------------------------------------------------- runs

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Run {
    pub id: i64,
    pub doc_id: i64,
    pub revision_id: i64,
    pub pass_slug: String,
    pub pass_name: String,
    pub provider: String,
    pub model: Option<String>,
    pub status: String,
    pub error: Option<String>,
    pub started_at: String,
    pub finished_at: Option<String>,
    pub usage: Usage,
}

fn run_from_row(row: &Row) -> rusqlite::Result<Run> {
    Ok(Run {
        id: row.get("id")?,
        doc_id: row.get("doc_id")?,
        revision_id: row.get("revision_id")?,
        pass_slug: row.get("pass_slug")?,
        pass_name: row.get("pass_name")?,
        provider: row.get("provider")?,
        model: row.get("model")?,
        status: row.get("status")?,
        error: row.get("error")?,
        started_at: row.get("started_at")?,
        finished_at: row.get("finished_at")?,
        usage: usage_from_row(row)?,
    })
}

pub fn start_run(
    conn: &Connection,
    doc_id: i64,
    revision_id: i64,
    pass_slug: &str,
    pass_name: &str,
    provider: &str,
    model: Option<&str>,
) -> AppResult<Run> {
    conn.execute(
        "insert into runs (doc_id, revision_id, pass_slug, pass_name, provider, model)
         values (?1, ?2, ?3, ?4, ?5, ?6)",
        params![doc_id, revision_id, pass_slug, pass_name, provider, model],
    )?;
    let id = conn.last_insert_rowid();
    let mut stmt = conn.prepare("select * from runs where id = ?1")?;
    Ok(stmt.query_row(params![id], run_from_row)?)
}

pub fn finish_run(
    conn: &Connection,
    id: i64,
    status: &str,
    error: Option<&str>,
    usage: Usage,
) -> AppResult<()> {
    conn.execute(
        "update runs set status = ?2, error = ?3, finished_at = datetime('now'),
                         input_tokens = ?4, output_tokens = ?5, cost_usd = ?6
         where id = ?1",
        params![id, status, error, usage.input_tokens, usage.output_tokens, usage.cost_usd],
    )?;
    Ok(())
}

pub fn list_runs(conn: &Connection, doc_id: i64, limit: i64) -> AppResult<Vec<Run>> {
    let mut stmt =
        conn.prepare("select * from runs where doc_id = ?1 order by id desc limit ?2")?;
    let rows = stmt.query_map(params![doc_id, limit], run_from_row)?;
    Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
}

// ----------------------------------------------------------------- findings

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Finding {
    pub id: i64,
    pub run_id: i64,
    pub doc_id: i64,
    pub category: String,
    pub severity: String,
    pub note: String,
    pub quote: String,
    pub prefix: String,
    pub suffix: String,
    pub status: String,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewFinding {
    pub category: String,
    pub severity: String,
    pub note: String,
    pub quote: String,
    #[serde(default)]
    pub prefix: String,
    #[serde(default)]
    pub suffix: String,
}

fn finding_from_row(row: &Row) -> rusqlite::Result<Finding> {
    Ok(Finding {
        id: row.get("id")?,
        run_id: row.get("run_id")?,
        doc_id: row.get("doc_id")?,
        category: row.get("category")?,
        severity: row.get("severity")?,
        note: row.get("note")?,
        quote: row.get("quote")?,
        prefix: row.get("prefix")?,
        suffix: row.get("suffix")?,
        status: row.get("status")?,
        created_at: row.get("created_at")?,
    })
}

pub fn add_findings(
    conn: &mut Connection,
    run_id: i64,
    doc_id: i64,
    items: &[NewFinding],
) -> AppResult<Vec<Finding>> {
    let tx = conn.transaction()?;
    let mut ids = Vec::with_capacity(items.len());
    {
        let mut stmt = tx.prepare(
            "insert into findings (run_id, doc_id, category, severity, note, quote, prefix, suffix)
             values (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        )?;
        for f in items {
            stmt.execute(params![
                run_id,
                doc_id,
                f.category,
                f.severity,
                f.note,
                f.quote,
                f.prefix,
                f.suffix
            ])?;
            ids.push(tx.last_insert_rowid());
        }
    }
    tx.commit()?;

    let mut out = Vec::with_capacity(ids.len());
    let mut stmt = conn.prepare("select * from findings where id = ?1")?;
    for id in ids {
        out.push(stmt.query_row(params![id], finding_from_row)?);
    }
    Ok(out)
}

pub fn list_findings(conn: &Connection, doc_id: i64) -> AppResult<Vec<Finding>> {
    let mut stmt = conn.prepare(
        "select * from findings where doc_id = ?1 order by severity = 'high' desc, id asc",
    )?;
    let rows = stmt.query_map(params![doc_id], finding_from_row)?;
    Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
}

pub fn set_finding_status(conn: &Connection, id: i64, status: &str) -> AppResult<()> {
    conn.execute("update findings set status = ?2 where id = ?1", params![id, status])?;
    Ok(())
}

pub fn clear_findings(conn: &Connection, doc_id: i64) -> AppResult<()> {
    conn.execute("delete from findings where doc_id = ?1", params![doc_id])?;
    Ok(())
}

// -------------------------------------------------------------------- duels

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Duel {
    pub id: i64,
    pub doc_id: i64,
    pub finding_id: Option<i64>,
    pub a_text: String,
    pub b_text: String,
    pub a_is_original: bool,
    pub judge_provider: String,
    pub judge_model: Option<String>,
    pub verdict: Option<String>,
    pub original_won: Option<bool>,
    pub reason: Option<String>,
    pub created_at: String,
    pub usage: Usage,
}

fn duel_from_row(row: &Row) -> rusqlite::Result<Duel> {
    Ok(Duel {
        id: row.get("id")?,
        doc_id: row.get("doc_id")?,
        finding_id: row.get("finding_id")?,
        a_text: row.get("a_text")?,
        b_text: row.get("b_text")?,
        a_is_original: row.get::<_, i64>("a_is_original")? != 0,
        judge_provider: row.get("judge_provider")?,
        judge_model: row.get("judge_model")?,
        verdict: row.get("verdict")?,
        original_won: row.get::<_, Option<i64>>("original_won")?.map(|v| v != 0),
        reason: row.get("reason")?,
        created_at: row.get("created_at")?,
        usage: usage_from_row(row)?,
    })
}

#[allow(clippy::too_many_arguments)]
pub fn record_duel(
    conn: &Connection,
    doc_id: i64,
    finding_id: Option<i64>,
    a_text: &str,
    b_text: &str,
    a_is_original: bool,
    judge_provider: &str,
    judge_model: Option<&str>,
    verdict: &str,
    reason: Option<&str>,
    usage: Usage,
) -> AppResult<Duel> {
    let original_won = match verdict {
        "A" => Some(a_is_original),
        "B" => Some(!a_is_original),
        _ => None,
    };
    conn.execute(
        "insert into duels (doc_id, finding_id, a_text, b_text, a_is_original,
                            judge_provider, judge_model, verdict, original_won, reason,
                            input_tokens, output_tokens, cost_usd)
         values (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)",
        params![
            doc_id,
            finding_id,
            a_text,
            b_text,
            a_is_original as i64,
            judge_provider,
            judge_model,
            verdict,
            original_won.map(|v| v as i64),
            reason,
            usage.input_tokens,
            usage.output_tokens,
            usage.cost_usd
        ],
    )?;
    let id = conn.last_insert_rowid();
    let mut stmt = conn.prepare("select * from duels where id = ?1")?;
    Ok(stmt.query_row(params![id], duel_from_row)?)
}

pub fn list_duels(conn: &Connection, doc_id: i64) -> AppResult<Vec<Duel>> {
    let mut stmt = conn.prepare("select * from duels where doc_id = ?1 order by id desc")?;
    let rows = stmt.query_map(params![doc_id], duel_from_row)?;
    Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn mem() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(SCHEMA).unwrap();
        conn
    }

    fn new_finding(quote: &str) -> NewFinding {
        NewFinding {
            category: "passive".into(),
            severity: "medium".into(),
            note: "The actor is missing.".into(),
            quote: quote.into(),
            prefix: String::new(),
            suffix: String::new(),
        }
    }

    #[test]
    fn creates_and_lists_documents() {
        let conn = mem();
        let doc = upsert_document(&conn, "/tmp/a.md", "First piece").unwrap();
        assert_eq!(doc.title, "First piece");
        assert_eq!(list_documents(&conn).unwrap().len(), 1);
        rename_document(&conn, doc.id, "Renamed").unwrap();
        assert_eq!(get_document(&conn, doc.id).unwrap().title, "Renamed");
    }

    #[test]
    fn registering_the_same_path_twice_updates_rather_than_duplicates() {
        let conn = mem();
        let a = upsert_document(&conn, "/tmp/x.md", "Draft").unwrap();
        let b = upsert_document(&conn, "/tmp/x.md", "Better title").unwrap();
        assert_eq!(a.id, b.id);
        assert_eq!(b.title, "Better title");
        assert_eq!(list_documents(&conn).unwrap().len(), 1);
    }

    #[test]
    fn untitled_drafts_have_rows_and_no_path() {
        let conn = mem();
        let a = create_untitled(&conn, "untitled").unwrap();
        let b = create_untitled(&conn, "untitled").unwrap();
        assert_ne!(a.id, b.id, "many untitled drafts can share a null path");
        assert_eq!(a.path, None);
        save_revision(&conn, a.id, "{}", "text", false, None).unwrap();
    }

    #[test]
    fn a_moved_document_keeps_its_history() {
        let conn = mem();
        let doc = create_untitled(&conn, "untitled").unwrap();
        save_revision(&conn, doc.id, "{}", "text", false, None).unwrap();
        let moved = move_document(&conn, doc.id, "/tmp/moved.md", "Moved").unwrap();
        assert_eq!(moved.id, doc.id);
        assert_eq!(moved.path.as_deref(), Some("/tmp/moved.md"));
        assert_eq!(moved.title, "Moved");
        assert_eq!(list_revisions(&conn, doc.id).unwrap().len(), 1);
        // Moving onto its own path again is not a clash.
        move_document(&conn, doc.id, "/tmp/moved.md", "Moved").unwrap();
    }

    #[test]
    fn a_move_onto_another_documents_path_is_refused() {
        let conn = mem();
        upsert_document(&conn, "/tmp/taken.md", "Taken").unwrap();
        let doc = create_untitled(&conn, "untitled").unwrap();
        let err = move_document(&conn, doc.id, "/tmp/taken.md", "x").unwrap_err();
        assert!(err.to_string().contains("already open"), "{err}");
        assert_eq!(get_document(&conn, doc.id).unwrap().path, None);
    }

    #[test]
    fn opened_documents_are_newest_first_and_never_deleted() {
        let conn = mem();
        let a = upsert_document(&conn, "/tmp/a.md", "a").unwrap();
        let b = upsert_document(&conn, "/tmp/b.md", "b").unwrap();
        upsert_document(&conn, "/tmp/never-opened.md", "c").unwrap();
        touch_opened(&conn, b.id).unwrap();
        std::thread::sleep(std::time::Duration::from_millis(5));
        touch_opened(&conn, a.id).unwrap();
        let ids: Vec<i64> = opened_documents(&conn).unwrap().iter().map(|d| d.id).collect();
        assert_eq!(ids, vec![a.id, b.id]);
        assert_eq!(list_documents(&conn).unwrap().len(), 3);
    }

    #[test]
    fn a_database_whose_paths_were_required_is_rebuilt_without_losing_rows() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch("pragma foreign_keys = on").unwrap();
        // The documents table as it was before untitled drafts.
        conn.execute_batch(
            "create table documents (id integer primary key, path text not null unique,
                                     title text not null,
                                     created_at text not null default (datetime('now')),
                                     updated_at text not null default (datetime('now')));
             insert into documents (id, path, title) values (7, '/tmp/old.md', 'Old');",
        )
        .unwrap();
        conn.execute_batch(SCHEMA).unwrap();
        conn.execute(
            "insert into revisions (doc_id, content_json, content_text) values (7, '{}', 'kept')",
            [],
        )
        .unwrap();

        migrate(&conn).unwrap();
        migrate(&conn).unwrap(); // a second start must not rebuild again

        let doc = get_document(&conn, 7).unwrap();
        assert_eq!(doc.path.as_deref(), Some("/tmp/old.md"));
        assert!(doc.opened_at.is_some(), "old rows show in the recent list");
        assert_eq!(list_revisions(&conn, 7).unwrap().len(), 1, "the drop did not cascade");
        create_untitled(&conn, "untitled").unwrap();
    }

    #[test]
    fn minor_revisions_collapse_but_major_ones_do_not() {
        let conn = mem();
        let doc = upsert_document(&conn, &format!("/tmp/{}.md", line!()), "d").unwrap();
        save_revision(&conn, doc.id, "{}", "one", false, None).unwrap();
        save_revision(&conn, doc.id, "{}", "two", false, None).unwrap();
        assert_eq!(list_revisions(&conn, doc.id).unwrap().len(), 1, "minor saves collapse");
        assert_eq!(latest_revision(&conn, doc.id).unwrap().unwrap().content_text, "two");

        save_revision(&conn, doc.id, "{}", "three", true, Some("after cuts")).unwrap();
        save_revision(&conn, doc.id, "{}", "four", false, None).unwrap();
        save_revision(&conn, doc.id, "{}", "five", false, None).unwrap();
        let revs = list_revisions(&conn, doc.id).unwrap();
        assert_eq!(revs.len(), 3, "major save is kept, later minor saves collapse onto one");
        assert_eq!(revs[0].content_text, "five");
        assert!(revs[1].major);
        assert_eq!(revs[1].label.as_deref(), Some("after cuts"));
    }

    #[test]
    fn revisions_chain_to_their_parent() {
        let conn = mem();
        let doc = upsert_document(&conn, &format!("/tmp/{}.md", line!()), "d").unwrap();
        let a = save_revision(&conn, doc.id, "{}", "one", true, None).unwrap();
        let b = save_revision(&conn, doc.id, "{}", "two", true, None).unwrap();
        assert_eq!(b.parent_id, Some(a.id));
        assert_eq!(a.parent_id, None);
    }

    #[test]
    fn stores_findings_against_a_run() {
        let mut conn = mem();
        let doc = upsert_document(&conn, &format!("/tmp/{}.md", line!()), "d").unwrap();
        let rev = save_revision(&conn, doc.id, "{}", "text", false, None).unwrap();
        let run = start_run(&conn, doc.id, rev.id, "passive", "Passive voice", "anthropic", Some("claude-opus-5")).unwrap();
        let saved = add_findings(&mut conn, run.id, doc.id, &[new_finding("was decided"), new_finding("were made")]).unwrap();
        assert_eq!(saved.len(), 2);
        assert_eq!(list_findings(&conn, doc.id).unwrap().len(), 2);

        set_finding_status(&conn, saved[0].id, "dismissed").unwrap();
        let after = list_findings(&conn, doc.id).unwrap();
        assert_eq!(after[0].status, "dismissed");

        finish_run(&conn, run.id, "done", None, Usage::default()).unwrap();
        assert_eq!(list_runs(&conn, doc.id, 10).unwrap()[0].status, "done");
    }

    #[test]
    fn deleting_a_document_takes_its_findings_with_it() {
        let mut conn = mem();
        let doc = upsert_document(&conn, &format!("/tmp/{}.md", line!()), "d").unwrap();
        let rev = save_revision(&conn, doc.id, "{}", "text", false, None).unwrap();
        let run = start_run(&conn, doc.id, rev.id, "p", "P", "anthropic", None).unwrap();
        add_findings(&mut conn, run.id, doc.id, &[new_finding("x")]).unwrap();
        delete_document(&conn, doc.id).unwrap();
        assert!(list_findings(&conn, doc.id).unwrap().is_empty());
        assert!(list_revisions(&conn, doc.id).unwrap().is_empty());
    }

    #[test]
    fn a_duel_records_whether_the_original_won() {
        let conn = mem();
        let doc = upsert_document(&conn, &format!("/tmp/{}.md", line!()), "d").unwrap();
        // The original was shown as B, and the judge picked B.
        let d = record_duel(&conn, doc.id, None, "rewrite", "original", false, "openai", Some("gpt-5"), "B", Some("tighter"), Usage::default()).unwrap();
        assert_eq!(d.original_won, Some(true));

        // Same layout, judge picked A, so the rewrite won.
        let d2 = record_duel(&conn, doc.id, None, "rewrite", "original", false, "openai", None, "A", None, Usage::default()).unwrap();
        assert_eq!(d2.original_won, Some(false));

        // A tie tells us nothing either way.
        let d3 = record_duel(&conn, doc.id, None, "a", "b", true, "openai", None, "tie", None, Usage::default()).unwrap();
        assert_eq!(d3.original_won, None);

        assert_eq!(list_duels(&conn, doc.id).unwrap().len(), 3);
    }

    #[test]
    fn a_run_left_open_is_closed_at_startup() {
        let conn = mem();
        let doc = upsert_document(&conn, "/tmp/orphan.md", "d").unwrap();
        let rev = save_revision(&conn, doc.id, "{}", "text", false, None).unwrap();
        let open = start_run(&conn, doc.id, rev.id, "p", "P", "anthropic", None).unwrap();
        let closed = start_run(&conn, doc.id, rev.id, "q", "Q", "anthropic", None).unwrap();
        finish_run(&conn, closed.id, "done", None, Usage::default()).unwrap();

        assert_eq!(recover_orphaned_runs(&conn).unwrap(), 1, "only the open one");

        let runs = list_runs(&conn, doc.id, 10).unwrap();
        let open_now = runs.iter().find(|r| r.id == open.id).unwrap();
        assert_eq!(open_now.status, "interrupted");
        assert!(open_now.finished_at.is_some());
        assert!(open_now.error.is_some());

        let closed_now = runs.iter().find(|r| r.id == closed.id).unwrap();
        assert_eq!(closed_now.status, "done", "a finished run is left alone");

        assert_eq!(recover_orphaned_runs(&conn).unwrap(), 0, "and it is idempotent");
    }

    #[test]
    fn missing_rows_report_not_found() {
        let conn = mem();
        assert!(matches!(get_document(&conn, 999), Err(AppError::NotFound(_))));
        assert!(matches!(get_revision(&conn, 999), Err(AppError::NotFound(_))));
    }

    // ------------------------------------------------------------- usage

    fn priced(input: i64, output: i64, cost: f64) -> Usage {
        Usage { input_tokens: Some(input), output_tokens: Some(output), cost_usd: Some(cost) }
    }

    fn unpriced(input: i64, output: i64) -> Usage {
        Usage { input_tokens: Some(input), output_tokens: Some(output), cost_usd: None }
    }

    /// A document with one saved revision, ready for runs.
    fn doc_with_revision(conn: &Connection, path: &str) -> (i64, i64) {
        let doc = upsert_document(conn, path, "T").unwrap();
        let rev = save_revision(conn, doc.id, "{}", "text", false, None).unwrap();
        (doc.id, rev.id)
    }

    #[test]
    fn a_finished_run_keeps_its_usage() {
        let conn = mem();
        let (doc, rev) = doc_with_revision(&conn, "/tmp/u1.md");
        let run = start_run(&conn, doc, rev, "p", "P", "deepseek", Some("deepseek-flash")).unwrap();
        finish_run(&conn, run.id, "done", None, priced(1200, 300, 0.00036)).unwrap();
        let back = &list_runs(&conn, doc, 10).unwrap()[0];
        assert_eq!(back.usage.input_tokens, Some(1200));
        assert_eq!(back.usage.output_tokens, Some(300));
        assert_eq!(back.usage.cost_usd, Some(0.00036));
    }

    #[test]
    fn a_file_totals_its_runs_and_duels_and_counts_what_has_no_price() {
        let conn = mem();
        let (doc, rev) = doc_with_revision(&conn, "/tmp/u2.md");
        let (other, other_rev) = doc_with_revision(&conn, "/tmp/u3.md");

        for usage in [priced(1000, 100, 0.01), priced(2000, 200, 0.02), unpriced(700, 50)] {
            let r = start_run(&conn, doc, rev, "p", "P", "x", None).unwrap();
            finish_run(&conn, r.id, "done", None, usage).unwrap();
        }
        // A CLI run: no tokens at all. It adds nothing either way.
        let cli = start_run(&conn, doc, rev, "p", "P", "claude-cli", None).unwrap();
        finish_run(&conn, cli.id, "done", None, Usage::default()).unwrap();
        record_duel(&conn, doc, None, "a", "b", true, "openai", None, "A", None, priced(500, 20, 0.005)).unwrap();

        // Another file's spending must not leak in.
        let r = start_run(&conn, other, other_rev, "p", "P", "x", None).unwrap();
        finish_run(&conn, r.id, "done", None, priced(9, 9, 9.0)).unwrap();

        let u = doc_usage(&conn, doc).unwrap();
        assert!((u.cost_usd - 0.035).abs() < 1e-12, "{u:?}");
        assert_eq!(u.priced_calls, 3);
        assert_eq!(u.unpriced_tokens, 750);
    }

    #[test]
    fn a_file_with_no_runs_totals_nothing() {
        let conn = mem();
        let (doc, _) = doc_with_revision(&conn, "/tmp/u4.md");
        assert_eq!(doc_usage(&conn, doc).unwrap(), DocUsage::default());
    }

    #[test]
    fn a_database_made_before_the_usage_columns_gains_them() {
        let conn = Connection::open_in_memory().unwrap();
        // The runs and duels tables as the first release made them.
        conn.execute_batch(
            "create table documents (id integer primary key, path text not null unique,
                                     title text not null,
                                     created_at text not null default (datetime('now')),
                                     updated_at text not null default (datetime('now')));
             create table runs (id integer primary key, doc_id integer not null,
                                revision_id integer not null, pass_slug text not null,
                                pass_name text not null, provider text not null, model text,
                                status text not null default 'running', error text,
                                started_at text not null default (datetime('now')),
                                finished_at text);
             create table duels (id integer primary key, doc_id integer not null,
                                 finding_id integer, a_text text not null, b_text text not null,
                                 a_is_original integer not null, judge_provider text not null,
                                 judge_model text, verdict text, original_won integer,
                                 reason text,
                                 created_at text not null default (datetime('now')));
             insert into documents (path, title) values ('/tmp/old.md', 'Old');
             insert into runs (doc_id, revision_id, pass_slug, pass_name, provider, status)
                    values (1, 1, 'p', 'P', 'anthropic', 'done');",
        )
        .unwrap();

        migrate(&conn).unwrap();
        migrate(&conn).unwrap(); // a second start must not fail

        let old = &list_runs(&conn, 1, 10).unwrap()[0];
        assert_eq!(old.usage.input_tokens, None, "old rows read as not recorded");
        assert_eq!(old.usage.cost_usd, None);
        assert_eq!(doc_usage(&conn, 1).unwrap(), DocUsage::default());
    }
}
