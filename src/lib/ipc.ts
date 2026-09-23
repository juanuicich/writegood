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
  /** Show the open file's running cost in the status bar (SPEC §9.4). */
  showCost: boolean;
}

export interface Provider {
  kind: "anthropic" | "openai" | "google" | "openai-compatible" | "cli" | "jev";
  model?: string | null;
  baseUrl?: string | null;
  keyRef?: string | null;
  command?: string | null;
  args: string[];
  jsonPath?: string | null;
  /** A cli provider: the JSON field that reports a failed call (SPEC §9.3). */
  jsonError?: string | null;
  /** A cli provider: files written into the call's empty directory. */
  files?: Record<string, string>;
  /** The most calls to this provider in flight at once (SPEC §8.3). */
  maxInFlight?: number | null;
  /** A cli provider: the text `{thinking}` becomes for a level (SPEC §9.3). */
  thinkingNames?: Record<string, string>;
  timeoutSecs: number;
  /** The vendor id in the price catalog, when it differs from the name. */
  catalog?: string | null;
  /** How much a reasoning model thinks. Absent keeps the provider's default
   *  (SPEC §9.1). */
  thinking?: Thinking | null;
  /** A jev provider: the keep threshold for its passes (SPEC §8.4). */
  keep?: number | null;
  /** US dollars per million tokens, used when the price catalog has no
   *  price for the model (SPEC §9.4). */
  price?: Rates | null;
}

export interface Rates {
  input: number;
  output: number;
  cacheRead?: number | null;
  cacheWrite?: number | null;
}

export type Thinking = "off" | "low" | "high" | "max";

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
  /** Overrides the provider's thinking for this pass (SPEC §8.1). */
  thinking?: Thinking | null;
  /** Overrides the provider's ceiling for this pass. */
  timeoutSecs?: number | null;
  /** The `[jev]` table, as written. Only a jev provider reads it (SPEC §8.4). */
  jev?: JevSettings | null;
}

export interface JevSettings {
  method?: string | null;
  keep?: number | null;
  note?: string | null;
}

export interface DocumentRow {
  id: number;
  /** Null for an untitled draft, which has no file yet (SPEC §6.3). */
  path: string | null;
  title: string;
  createdAt: string;
  updatedAt: string;
  openedAt: string | null;
}

/** A document and its text, as the editor loads it. */
export interface Opened {
  doc: DocumentRow;
  text: string;
}

/** One line of the recent list. */
export interface Recent {
  id: number;
  path: string | null;
  title: string;
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

/** Tokens one call used. `input` includes the cache reads and writes. */
export interface Tokens {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

/** A network reply. `tokens` is null when the provider reported no usage;
 *  `costUsd` is null when the price catalog does not know the model. */
export interface Reply {
  text: string;
  tokens: Tokens | null;
  costUsd: number | null;
}

/** A Jev reply (SPEC §9.5). Rust does not read `answers`; `jev.ts` does.
 *  `unreadable` says why a body could not be read, and `answers` is then
 *  null. `model` is the version that answered. */
export interface JevReply {
  answers: unknown;
  tokens: Tokens | null;
  costUsd: number | null;
  model: string | null;
  unreadable: string | null;
}

/** What a run or a duel used, summed over its calls. Null means not
 *  recorded, never zero. */
export interface Usage {
  inputTokens: number | null;
  outputTokens: number | null;
  costUsd: number | null;
}

/** One file's running total across its runs and duels. */
export interface DocUsage {
  costUsd: number;
  pricedCalls: number;
  unpricedTokens: number;
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
  usage: Usage;
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
  usage: Usage;
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

/** Documents on disk (SPEC §6.3). Rust picks every path through a native
 *  dialog and writes only a document's own file or its recovery file. */
export const files = {
  /** The native open dialog. Null when the author cancels. */
  pickOpen: (from: string | null) => invoke<string | null>("doc_pick_open", { from }),
  /** The native save dialog. The path it returns always has an extension. */
  pickSave: (suggested: string, from: string | null) =>
    invoke<string | null>("doc_pick_save", { suggested, from }),
  open: (path: string) => invoke<Opened>("doc_open", { path }),
  reopen: (id: number) => invoke<Opened>("doc_reopen", { id }),
  create: () => invoke<Opened>("doc_new"),
  save: (id: number, text: string) => invoke<DocumentRow>("doc_save", { id, text }),
  saveAs: (id: number, path: string, text: string) =>
    invoke<DocumentRow>("doc_save_as", { id, path, text }),
  recent: () => invoke<Recent[]>("doc_recent"),
};

export const store = {
  register: (path: string, title: string) =>
    invoke<DocumentRow>("db_register", { path, title }),
  documents: () => invoke<DocumentRow[]>("db_documents"),

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
  finishRun: (id: number, status: string, error: string | null, usage: Usage) =>
    invoke<void>("run_finish", { id, status, error, usage }),
  runs: (docId: number, limit?: number) => invoke<Run[]>("run_list", { docId, limit }),

  /** Store one answer. With a key, it replaces the earlier answer with that
   *  key and is recorded as reviewed (SPEC §8.3). */
  addFindings: (runId: number, docId: number, key: string | null, items: NewFinding[]) =>
    invoke<Finding[]>("findings_add", { runId, docId, key, items }),
  /** At the end of a pass: supersede the findings whose key is not listed. */
  retainFindings: (runId: number, keys: string[]) => invoke<void>("findings_retain", { runId, keys }),
  /** The keys a pass already has answers for. */
  reviewedKeys: (docId: number, passSlug: string) =>
    invoke<string[]>("findings_reviewed", { docId, passSlug }),
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
    usage: Usage;
  }) => invoke<Duel>("duel_record", args),
  duels: (docId: number) => invoke<Duel[]>("duel_list", { docId }),
  usage: (docId: number) => invoke<DocUsage>("doc_usage", { docId }),
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
  chat: (name: string, provider: Provider, system: string, prompt: string) =>
    invoke<Reply>("llm_chat", { name, provider, system, prompt }),
};

/** A request to Jev, TypeSafe's decision model (SPEC §9.5). Rust makes it,
 *  for the same reasons as `llm.chat`. */
export const jev = {
  ask: (name: string, provider: Provider, state: unknown, questions: unknown) =>
    invoke<JevReply>("jev_ask", { name, provider, state, questions }),
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
