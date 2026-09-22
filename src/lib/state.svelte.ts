/** One store for the whole app. Small enough that splitting it would cost more
 *  than it saves. */
import type { Editor } from "@tiptap/core";
import {
  cfg,
  files,
  store,
  anchors as anchorApi,
  diff as diffApi,
  type Config,
  type DocSummary,
  type DocumentRow,
  type Finding,
  type Pass,
  type Chunk,
  type Paths,
  type Revision,
} from "./ipc";
import { buildTextIndex, codePointRangeToPM, type TextIndex } from "./text";
import type { DuelOutcome } from "./duel/run";
import { markdownToJSON, jsonToMarkdown } from "./markdown";

export interface HistoryState {
  revisions: Revision[];
  index: number;
  chunks: Chunk[];
}

export interface DuelState {
  original: string;
  rewrite: string;
  findingId: number | null;
  result: DuelOutcome | null;
  busy: boolean;
  error: string;
}

/** A finding plus where it currently sits in the open document. */
export interface Placed extends Finding {
  from: number | null;
  to: number | null;
  exact: boolean;
}

class App {
  config = $state<Config | null>(null);
  paths = $state<Paths | null>(null);
  passes = $state<Pass[]>([]);

  docs = $state<DocSummary[]>([]);
  doc = $state<DocumentRow | null>(null);
  editor = $state<Editor | null>(null);

  findings = $state<Placed[]>([]);
  cursor = $state(-1);

  status = $state("");
  mode = $state<"write" | "review">("write");
  duel = $state<DuelState | null>(null);
  history = $state<HistoryState | null>(null);
  revealed = $state<number[]>([]);
  dirty = $state(false);
  busy = $state(0);
  /** What the pass runner is waiting for, so the status bar can say it. */
  progress = $state<{ done: number; total: number; active: string[] } | null>(null);
  paletteOpen = $state(false);
  sidebarForced = $state(false);

  /** Only open findings are worth stepping through, and the margin reads in
   *  document order. Findings that no longer place sort last. */
  visible = $derived(
    this.findings
      .filter((f) => f.status === "open" || f.status === "addressed")
      .sort((a, b) => {
        if (a.from === null && b.from === null) return a.id - b.id;
        if (a.from === null) return 1;
        if (b.from === null) return -1;
        return a.from - b.from || severity(b) - severity(a);
      }),
  );

  current = $derived(this.visible[this.cursor] ?? null);

  showSidebar = $derived(this.sidebarForced || this.visible.length > 0);

  // ------------------------------------------------------------- lifecycle

  async boot() {
    this.config = await cfg.load();
    this.paths = await cfg.paths();
    this.passes = await cfg.passes();
    this.applyAppearance();
    await this.refreshDocs();
    if (!this.doc && this.docs.length > 0) {
      await this.open(this.docs[0].path);
    }
  }

  applyAppearance() {
    const a = this.config?.appearance;
    if (!a) return;
    const root = document.documentElement;
    root.style.setProperty("--serif", a.font);
    root.style.setProperty("--size", `${a.fontSize}px`);
    root.style.setProperty("--measure", `${a.measure}ch`);
    if (a.theme === "system") root.removeAttribute("data-theme");
    else root.setAttribute("data-theme", a.theme);
  }

  async refreshDocs() {
    this.docs = await files.list();
    await store.forgetMissing(this.docs.map((d) => d.path));
  }

  // -------------------------------------------------------------- document

  async open(path: string) {
    const text = await files.read(path);
    const summary = this.docs.find((d) => d.path === path);
    this.doc = await store.register(path, summary?.title ?? path);
    this.editor?.commands.setContent(markdownToContent(text));
    this.dirty = false;
    this.cursor = -1;
    await this.loadFindings();
    this.say(this.doc.title);
  }

  async create(title: string) {
    const path = await files.create(title || "Untitled");
    await this.refreshDocs();
    await this.open(path);
  }

  /** Write the Markdown file first, the revision row second. A failed write
   *  must not advance the history (SPEC 6.1). */
  async save(major = false, label?: string) {
    if (!this.doc || !this.editor) return;
    const md = contentToMarkdown(this.editor);
    await files.write(this.doc.path, md);
    await store.saveRevision(
      this.doc.id,
      JSON.stringify(this.editor.getJSON()),
      this.plainText(),
      major,
      label ?? null,
    );
    this.dirty = false;
    await this.refreshDocs();
    this.say(major ? `saved — ${label ?? "major revision"}` : "saved");
  }

  plainText(): string {
    return this.editor ? this.index().text : "";
  }

  index(): TextIndex {
    if (!this.editor) return { text: "", pos: [] };
    return buildTextIndex(this.editor.state.doc);
  }

  // -------------------------------------------------------------- findings

  async loadFindings() {
    if (!this.doc) return;
    const rows = await store.findings(this.doc.id);
    this.findings = rows.map((f) => ({ ...f, from: null, to: null, exact: false }));
    await this.reanchor();
  }

  /** Place every finding against the current text. Rust does the matching;
   *  we only map its code point offsets onto ProseMirror positions. */
  async reanchor() {
    if (!this.editor || this.findings.length === 0) return;
    const idx = this.index();
    const resolved = await anchorApi.resolve(
      idx.text,
      this.findings.map((f) => ({
        id: f.id,
        quote: f.quote,
        prefix: f.prefix,
        suffix: f.suffix,
      })),
    );
    const byId = new Map(resolved.map((a) => [a.id, a]));
    this.findings = this.findings.map((f) => {
      const a = byId.get(f.id);
      if (!a || a.from === null || a.to === null) {
        return { ...f, from: null, to: null, exact: false, status: stale(f.status) };
      }
      const pm = codePointRangeToPM(idx, a.from, a.to);
      return pm
        ? { ...f, from: pm.from, to: pm.to, exact: a.exact, status: unstale(f.status) }
        : { ...f, from: null, to: null, exact: false, status: stale(f.status) };
    });
  }

  step(delta: number) {
    const n = this.visible.length;
    if (n === 0) return;
    this.cursor = nextCursor(this.cursor, delta, n);
    this.scrollToCurrent();
  }

  select(id: number) {
    const i = this.visible.findIndex((f) => f.id === id);
    if (i >= 0) {
      this.cursor = i;
      this.scrollToCurrent();
    }
  }

  scrollToCurrent() {
    const f = this.current;
    if (!f || f.from === null || !this.editor) return;
    this.editor.commands.setTextSelection({ from: f.from, to: f.to ?? f.from });
    this.editor.commands.scrollIntoView();
  }

  toggleReveal(id?: number) {
    const target = id ?? this.current?.id;
    if (target === undefined) return;
    this.revealed = this.revealed.includes(target)
      ? this.revealed.filter((x) => x !== target)
      : [...this.revealed, target];
  }

  async mark(status: "addressed" | "dismissed") {
    const f = this.current;
    if (!f) return;
    await store.setFindingStatus(f.id, status);
    this.findings = this.findings.map((x) => (x.id === f.id ? { ...x, status } : x));
    if (this.cursor >= this.visible.length) this.cursor = this.visible.length - 1;
    this.say(status);
  }

  // --------------------------------------------------------------- history

  async openHistory() {
    if (!this.doc) return;
    const revisions = await store.revisions(this.doc.id);
    if (revisions.length === 0) {
      this.say("no revisions yet");
      return;
    }
    this.history = { revisions, index: 0, chunks: [] };
    await this.diffHistory();
  }

  async stepHistory(delta: number) {
    const h = this.history;
    if (!h) return;
    h.index = Math.min(Math.max(h.index + delta, 0), h.revisions.length - 1);
    await this.diffHistory();
  }

  /** What changed between the selected revision and the draft as it stands. */
  private async diffHistory() {
    const h = this.history;
    if (!h) return;
    h.chunks = await diffApi.words(h.revisions[h.index].contentText, this.plainText());
  }

  /** Put an old revision back. Nothing is lost: the current text was already
   *  saved, and this save adds another revision on top. */
  async restoreHistory() {
    const h = this.history;
    if (!h || !this.editor) return;
    const rev = h.revisions[h.index];
    this.editor.commands.setContent(JSON.parse(rev.contentJson));
    this.history = null;
    await this.save(true, `restored ${rev.createdAt}`);
    await this.reanchor();
    this.editor.commands.focus();
  }

  closeHistory() {
    this.history = null;
    this.editor?.commands.focus();
  }

  // ------------------------------------------------------------------ duel

  /** The paragraph the cursor sits in. The duel compares one paragraph at a
   *  time, because that is the unit an author actually rewrites. */
  paragraphAtCursor(): string {
    if (!this.editor) return "";
    // Not destructured: Svelte reserves the `$` prefix for identifiers in a
    // .svelte.ts file, and ProseMirror's resolved position is called `$from`.
    const at = this.editor.state.selection.$from;
    return at.parent.textContent.trim();
  }

  openDuel() {
    const original = this.paragraphAtCursor();
    if (!original) {
      this.say("put the cursor in a paragraph first");
      return;
    }
    this.duel = {
      original,
      rewrite: "",
      findingId: this.current?.id ?? null,
      result: null,
      busy: false,
      error: "",
    };
  }

  closeDuel() {
    this.duel = null;
    this.editor?.commands.focus();
  }

  // ----------------------------------------------------------------- chrome

  say(message: string) {
    this.status = message;
  }

  async withBusy<T>(label: string, work: () => Promise<T>): Promise<T> {
    this.busy += 1;
    this.say(label);
    try {
      return await work();
    } finally {
      this.busy -= 1;
    }
  }
}

/** Step the focus through the list, wrapping at both ends. A cursor of -1
 *  means nothing is focused yet, so stepping forward lands on the first. */
export function nextCursor(cursor: number, delta: number, count: number): number {
  if (count <= 0) return -1;
  return (((cursor + delta) % count) + count) % count;
}

const RANK = { low: 0, medium: 1, high: 2 } as const;
function severity(f: Finding): number {
  return RANK[f.severity as keyof typeof RANK] ?? 0;
}

function stale(s: Finding["status"]) {
  return s === "open" ? ("stale" as const) : s;
}
function unstale(s: Finding["status"]) {
  return s === "stale" ? ("open" as const) : s;
}

// Wrappers so the store never passes an editor instance into markdown.ts,
// which deliberately knows nothing about TipTap's runtime.
function markdownToContent(md: string) {
  return markdownToJSON(md);
}
function contentToMarkdown(editor: Editor): string {
  return jsonToMarkdown(editor.getJSON() as Record<string, unknown>);
}

export const app = new App();
