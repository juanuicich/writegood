/** Typed wrappers over the Rust command surface in `src-tauri/src/lib.rs`.
 *  Nothing else in the frontend calls `invoke` directly. */
import { invoke } from "@tauri-apps/api/core";

// ------------------------------------------------------------------ types

export interface Rules {
  allowSuggestions: boolean;
  redactSuggestions: boolean;
  forbidPraise: boolean;
  blindJudge: boolean;
}

export interface Appearance {
  font: string;
  fontSize: number;
  measure: number;
  theme: "light" | "dark" | "system";
}

export interface Provider {
  kind: "anthropic" | "openai" | "google" | "openai-compatible" | "cli";
  model?: string | null;
  baseUrl?: string | null;
  keyRef?: string | null;
  command?: string | null;
  args: string[];
  jsonPath?: string | null;
  timeoutSecs: number;
}

export interface Config {
  defaultProvider: string;
  judgeProvider?: string | null;
  rules: Rules;
  appearance: Appearance;
  providers: Record<string, Provider>;
}

export interface Paths {
  home: string;
  config: string;
  documents: string;
  passes: string;
  db: string;
}

export interface Pass {
  slug: string;
  name: string;
  category: string;
  scope: "paragraph" | "document";
  provider?: string | null;
  enabled: boolean;
  prompt: string;
  path: string;
}

export interface DocSummary {
  path: string;
  title: string;
  modified: number;
  words: number;
}

export interface DocumentRow {
  id: number;
  path: string;
  title: string;
  createdAt: string;
  updatedAt: string;
}

export interface Revision {
  id: number;
  docId: number;
  parentId: number | null;
  contentJson: string;
  contentText: string;
  major: boolean;
  label: string | null;
  createdAt: string;
}

export interface Run {
  id: number;
  docId: number;
  revisionId: number;
  passSlug: string;
  passName: string;
  provider: string;
  model: string | null;
  status: string;
  error: string | null;
  startedAt: string;
  finishedAt: string | null;
}

export type Severity = "low" | "medium" | "high";
export type FindingStatus = "open" | "addressed" | "dismissed" | "stale";

export interface NewFinding {
  category: string;
  severity: Severity;
  note: string;
  quote: string;
  prefix: string;
  suffix: string;
}

export interface Finding extends NewFinding {
  id: number;
  runId: number;
  docId: number;
  status: FindingStatus;
  createdAt: string;
}

export interface Duel {
  id: number;
  docId: number;
  findingId: number | null;
  aText: string;
  bText: string;
  aIsOriginal: boolean;
  judgeProvider: string;
  judgeModel: string | null;
  verdict: string | null;
  originalWon: boolean | null;
  reason: string | null;
  createdAt: string;
}

export interface Chunk {
  kind: "equal" | "insert" | "delete";
  text: string;
}

export interface Selector {
  id: number;
  quote: string;
  prefix: string;
  suffix: string;
}

export interface Anchor {
  id: number;
  from: number | null;
  to: number | null;
  score: number;
  exact: boolean;
}

// --------------------------------------------------------------- commands

export const cfg = {
  load: () => invoke<Config>("config_load"),
  save: (config: Config) => invoke<void>("config_save", { config }),
  paths: () => invoke<Paths>("config_paths"),
  passes: () => invoke<Pass[]>("passes_list"),
};

export const secrets = {
  set: (service: string, account: string, value: string) =>
    invoke<void>("secret_set", { service, account, value }),
  remove: (service: string, account: string) =>
    invoke<void>("secret_delete", { service, account }),
  has: (service: string, account: string) =>
    invoke<boolean>("secret_has", { service, account }),
  resolve: (keyRef: string | null | undefined) =>
    invoke<string | null>("key_resolve", { keyRef: keyRef ?? null }),
};

export const files = {
  list: () => invoke<DocSummary[]>("doc_list"),
  read: (path: string) => invoke<string>("doc_read", { path }),
  write: (path: string, text: string) => invoke<void>("doc_write", { path, text }),
  create: (title: string) => invoke<string>("doc_create", { title }),
  remove: (path: string) => invoke<void>("doc_delete", { path }),
  rename: (path: string, title: string) => invoke<string>("doc_rename", { path, title }),
};

export const store = {
  register: (path: string, title: string) =>
    invoke<DocumentRow>("db_register", { path, title }),
  documents: () => invoke<DocumentRow[]>("db_documents"),
  forgetMissing: (present: string[]) => invoke<number>("db_forget_missing", { present }),

  saveRevision: (
    docId: number,
    contentJson: string,
    contentText: string,
    major: boolean,
    label?: string | null,
  ) =>
    invoke<Revision>("rev_save", {
      docId,
      contentJson,
      contentText,
      major,
      label: label ?? null,
    }),
  revisions: (docId: number) => invoke<Revision[]>("rev_list", { docId }),
  flagRevision: (id: number, major: boolean, label?: string | null) =>
    invoke<void>("rev_flag", { id, major, label: label ?? null }),

  startRun: (
    docId: number,
    revisionId: number,
    passSlug: string,
    passName: string,
    provider: string,
    model?: string | null,
  ) =>
    invoke<Run>("run_start", {
      docId,
      revisionId,
      passSlug,
      passName,
      provider,
      model: model ?? null,
    }),
  finishRun: (id: number, status: string, error?: string | null) =>
    invoke<void>("run_finish", { id, status, error: error ?? null }),
  runs: (docId: number, limit?: number) => invoke<Run[]>("run_list", { docId, limit }),

  addFindings: (runId: number, docId: number, items: NewFinding[]) =>
    invoke<Finding[]>("findings_add", { runId, docId, items }),
  findings: (docId: number) => invoke<Finding[]>("findings_list", { docId }),
  setFindingStatus: (id: number, status: FindingStatus) =>
    invoke<void>("findings_status", { id, status }),
  clearFindings: (docId: number) => invoke<void>("findings_clear", { docId }),

  recordDuel: (args: {
    docId: number;
    findingId: number | null;
    aText: string;
    bText: string;
    aIsOriginal: boolean;
    judgeProvider: string;
    judgeModel: string | null;
    verdict: string;
    reason: string | null;
  }) => invoke<Duel>("duel_record", args),
  duels: (docId: number) => invoke<Duel[]>("duel_list", { docId }),
};

export const anchors = {
  resolve: (text: string, selectors: Selector[]) =>
    invoke<Anchor[]>("anchors_resolve", { text, selectors }),
};

/** A line in `~/.writegood/writegood.log`. The webview console is invisible
 *  in a built app, so this is the only record of what a pass actually did. */
export const log = {
  write: (level: "info" | "warn" | "error", message: string) =>
    invoke<void>("app_log", { level, message }).catch(() => {}),
  path: () => invoke<string>("log_path"),
};

export const diff = {
  words: (before: string, after: string) => invoke<Chunk[]>("diff_words", { before, after }),
};

export const cli = {
  run: (provider: Provider, prompt: string) =>
    invoke<string>("cli_run", { provider, prompt }),
};

/** The network provider call. It runs in Rust: a webview whose window is not
 *  visible is suspended by macOS, which froze a pass mid-run when this lived
 *  in the frontend. Keys never reach the webview either. */
export const llm = {
  chat: (provider: Provider, system: string, prompt: string) =>
    invoke<string>("llm_chat", { provider, system, prompt }),
};

/** Open a path with the system default application. Rust owns the filesystem,
 *  so Rust opens it; the opener plugin is not called from the webview. */
export const shell = {
  openPath: (path: string) => invoke<void>("shell_open_path", { path }),
};

/** Menu items emit a palette command id. The listener runs that command, so
 *  the menu and the keyboard cannot drift apart. The menu is macOS-only, and
 *  there is no Tauri at all in the browser fixtures, so both cases return a
 *  no-op unsubscribe. */
export async function onMenuCommand(
  handler: (id: string) => void,
): Promise<() => void> {
  if (typeof window === "undefined" || !("__TAURI_INTERNALS__" in window)) {
    return () => {};
  }
  const { listen } = await import("@tauri-apps/api/event");
  return listen<string>("menu-command", (e) => handler(e.payload));
}
