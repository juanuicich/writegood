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
  type DocUsage,
  type Opened,
  type Recent,
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
import { tidy } from "./spans";
import * as find from "./editor/search";

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

  /** Documents opened before, newest first, from any folder (SPEC §6.3). */
  recent = $state<Recent[]>([]);
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
  /** The open file's running cost (SPEC §9.4). Null until loaded. */
  usage = $state<DocUsage | null>(null);
  /** What the pass runner is waiting for, so the status bar can say it. */
  progress = $state<{ done: number; total: number; active: string[] } | null>(null);
  paletteOpen = $state(false);
  /** The help page covers the draft. The draft stays mounted underneath it,
   *  so its text, selection, undo history and scroll survive. */
  help = $state(false);
  /** The author's choice for the margin: shown, hidden, or null to show it
   *  when there are findings (SPEC §12.1). */
  margin = $state<boolean | null>(null);

  /** The find bar, when open. `seq` is bumped on every open, so the bar
   *  selects its field again (SPEC §12.6). */
  find = $state<{ replace: boolean; seq: number } | null>(null);
  /** The query and the replacement, kept for the session. */
  findText = $state("");
  replaceText = $state("");

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

  /** The findings a click in the text lit together. Null when one finding is
   *  lit, the focused one, which is every case but that click (SPEC §12.3). */
  group = $state<number[] | null>(null);

  /** Set when the author goes back to writing, so nothing is lit while they
   *  write. The focus is kept, so the next step goes on from it. Any focus
   *  change, or a return to review mode, lights it again (SPEC §12.4). */
  quiet = $state(false);

  /** What is lit, in the text and in the margin. */
  lit = $derived.by(() => {
    if (this.quiet) return [];
    const shown = this.group?.filter((id) => this.visible.some((f) => f.id === id));
    if (shown && shown.length > 0) return shown;
    return this.current ? [this.current.id] : [];
  });

  /** Bumped on every focus change, with how it was made, so the margin can
   *  align a note to its highlight after a click in the text or a step, and
   *  only reveal it after a click on the note (SPEC §12.3). */
  focus = $state<{ seq: number; by: "text" | "step" | "note" }>({ seq: 0, by: "note" });

  showSidebar = $derived(this.margin ?? this.visible.length > 0);

  // ------------------------------------------------------------- lifecycle

  async boot() {
    this.config = await cfg.load();
    this.paths = await cfg.paths();
    this.passes = await cfg.passes();
    this.applyAppearance();
    // Reopen the last document. With none, or with its file gone, start an
    // untitled draft (SPEC §6.3).
    await this.refreshRecent();
    const last = this.recent[0];
    try {
      if (last) return await this.reopen(last.id);
    } catch (e) {
      this.say(String(e));
    }
    await this.create();
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

  async refreshRecent() {
    this.recent = await files.recent();
  }

  // -------------------------------------------------------------- document

  /** True while the open draft has no file. The unsaved mark stays on: the
   *  recovery file is not the author's file. */
  get untitled(): boolean {
    return this.doc !== null && this.doc.path === null;
  }

  /** The native open dialog, starting in the open document's folder. */
  async openDialog() {
    const path = await files.pickOpen(this.doc?.path ?? null);
    if (path) await this.open(path);
  }

  async open(path: string) {
    await this.flush();
    await this.load(await files.open(path));
  }

  /** Open by id: a recent file, or an untitled draft's recovery file. */
  async reopen(id: number) {
    await this.flush();
    await this.load(await files.reopen(id));
  }

  /** ⌘N: an untitled draft. It asks nothing; the first ⌘S asks where. */
  async create() {
    await this.flush();
    await this.load(await files.create());
  }

  /** Write what autosave has not written yet, before the editor is reused
   *  for another document. */
  private async flush() {
    if (this.doc && this.dirty) await this.save(false);
  }

  private async load(opened: Opened) {
    this.doc = opened.doc;
    this.editor?.commands.setContent(markdownToContent(opened.text));
    this.dirty = false;
    this.cursor = -1;
    this.group = null;
    await this.loadFindings();
    await this.loadUsage();
    await this.refreshRecent();
    this.say(this.doc.title);
  }

  /** Re-read the open file's total. Called when a file opens and after every
   *  call that spends: a review, a duel. */
  async loadUsage() {
    const doc = this.doc;
    this.usage = doc ? await store.usage(doc.id) : null;
  }

  /** Write the Markdown file first, the revision row second. A failed write
   *  must not advance the history (SPEC 6.1). Autosave calls this too. An
   *  untitled draft is written to its recovery file. */
  async save(major = false, label?: string) {
    const doc = this.doc;
    if (!doc || !this.editor) return;
    const md = contentToMarkdown(this.editor);
    const saved = await files.save(doc.id, md);
    // Another document opened while this one was written. Its row is not
    // this one, and neither is the editor's text.
    if (this.doc?.id !== doc.id) return;
    this.doc = saved;
    await this.revision(major, label);
    if (this.doc.path) {
      this.say(major ? `saved — ${label ?? "major revision"}` : this.saved(this.doc.path));
    }
  }

  /** ⌘S: save, or ask where if the draft has no file yet. */
  async saveNow() {
    if (this.untitled) await this.saveAs();
    else await this.save(false);
  }

  /** ⌘⇧S, and the first save of an untitled draft: the native save dialog.
   *  The document's history and findings move with it. False when the author
   *  cancels or the save fails. */
  async saveAs(): Promise<boolean> {
    const doc = this.doc;
    if (!doc || !this.editor) return false;
    const path = await files.pickSave(doc.title, doc.path);
    if (!path) {
      this.say("not saved");
      return false;
    }
    try {
      const saved = await files.saveAs(doc.id, path, contentToMarkdown(this.editor));
      if (this.doc?.id !== doc.id) return false;
      this.doc = saved;
    } catch (e) {
      this.say(e instanceof Error ? e.message : String(e));
      return false;
    }
    await this.revision(false);
    await this.refreshRecent();
    this.say(this.saved(path));
    return true;
  }

  /** ⌘⌥S. An untitled draft needs a file first. */
  async saveMajor(label: string) {
    if (this.untitled && !(await this.saveAs())) return;
    await this.save(true, label);
  }

  private async revision(major: boolean, label?: string) {
    if (!this.doc || !this.editor) return;
    await store.saveRevision(
      this.doc.id,
      JSON.stringify(this.editor.getJSON()),
      this.plainText(),
      major,
      label ?? null,
    );
    this.dirty = false;
  }

  /** Ids of the .txt documents already told about Markdown escapes. */
  private noted = new Set<number>();

  /** The status line after a save. The first save of a .txt file says the
   *  file is now written as Markdown (SPEC §6.3). */
  private saved(path: string): string {
    const id = this.doc?.id;
    if (id !== undefined && path.toLowerCase().endsWith(".txt") && !this.noted.has(id)) {
      this.noted.add(id);
      return "saved — as Markdown, which can add escapes to a .txt file";
    }
    return "saved";
  }

  plainText(): string {
    return this.editor ? this.index().text : "";
  }

  index(): TextIndex {
    if (!this.editor) return { text: "", pos: [] };
    return buildTextIndex(this.editor.state.doc);
  }

  // -------------------------------------------------------------- findings

  /** Loads and re-anchoring run one at a time. A pass run loads after every
   *  model call, and the editor re-anchors after typing, so without the queue
   *  an older result could land after a newer one. */
  private findingsQueue: Promise<void> = Promise.resolve();

  private queueFindings(job: () => Promise<void>): Promise<void> {
    const next = this.findingsQueue.then(job);
    this.findingsQueue = next.catch(() => {});
    return next;
  }

  /** Read the findings from the database and place them. The list changes in
   *  one assignment, so the margin never sees them unplaced. */
  loadFindings(): Promise<void> {
    return this.queueFindings(async () => {
      if (!this.doc) return;
      const docId = this.doc.id;
      const rows = await store.findings(docId);
      if (this.doc?.id !== docId) return;
      const list: Placed[] = rows.map((f) => ({ ...f, from: null, to: null, exact: false }));
      this.setFindings(this.editor ? await this.placed(list) : list);
    });
  }

  /** Place every finding against the current text. */
  reanchor(): Promise<void> {
    return this.queueFindings(async () => {
      if (!this.editor || this.findings.length === 0) return;
      this.setFindings(await this.placed(this.findings));
    });
  }

  /** Replace the list and keep the focus on the same finding. New findings
   *  can arrive above it while a run goes on (SPEC §8.3). A focused finding
   *  that is gone leaves nothing focused. */
  private setFindings(list: Placed[]) {
    const id = this.current?.id;
    this.findings = list;
    this.cursor = id === undefined ? -1 : this.visible.findIndex((f) => f.id === id);
  }

  /** Rust does the matching; we only map its code point offsets onto
   *  ProseMirror positions. A status changed while Rust worked is kept. */
  private async placed(list: Placed[]): Promise<Placed[]> {
    const idx = this.index();
    const resolved = await anchorApi.resolve(
      idx.text,
      list.map((f) => ({
        id: f.id,
        quote: f.quote,
        prefix: f.prefix,
        suffix: f.suffix,
      })),
    );
    const byId = new Map(resolved.map((a) => [a.id, a]));
    // Tidy the drawn edges across every placed range at once, since the rule
    // for overlapping ends needs to see them together (SPEC §12.3).
    const placed = list.map((f) => {
      const a = byId.get(f.id);
      return a && a.from !== null && a.to !== null ? { from: a.from, to: a.to } : null;
    });
    const drawn = tidy(idx.text, placed);
    const marked = new Map(this.findings.map((f) => [f.id, f.status]));
    return list.map((f, i) => {
      const a = byId.get(f.id);
      const r = drawn[i];
      const status = marked.get(f.id) ?? f.status;
      if (!a || !r) {
        return { ...f, from: null, to: null, exact: false, status: stale(status) };
      }
      const pm = codePointRangeToPM(idx, r.from, r.to);
      return pm
        ? { ...f, from: pm.from, to: pm.to, exact: a.exact, status: unstale(status) }
        : { ...f, from: null, to: null, exact: false, status: stale(status) };
    });
  }

  step(delta: number) {
    const n = this.visible.length;
    if (n === 0) return;
    this.cursor = nextCursor(this.cursor, delta, n);
    this.focused("step");
    // The margin scrolls the draft for a step, and only as far as it must.
    this.selectCurrent();
  }

  /** Focus one finding, from a click on its note in the margin. */
  select(id: number) {
    const i = this.visible.findIndex((f) => f.id === id);
    if (i >= 0) {
      this.cursor = i;
      this.focused("note");
      this.scrollToCurrent();
    }
  }

  /** A click on a highlight in the text: light every finding under it, and
   *  focus the first in document order. The draft stays where it is. */
  selectInText(ids: number[]) {
    const i = this.visible.findIndex((f) => ids.includes(f.id));
    if (i < 0) return;
    this.cursor = i;
    this.focused("text", ids);
    this.selectCurrent();
  }

  private focused(by: "text" | "step" | "note", group: number[] | null = null) {
    this.group = group && group.length > 1 ? group : null;
    this.quiet = false;
    this.focus = { seq: this.focus.seq + 1, by };
  }

  /** Select the focused finding's words. The selection is marked as the
   *  focus's own, so the margin does not treat it as the caret moving. */
  private selectCurrent(): boolean {
    const f = this.current;
    if (!f || f.from === null || !this.editor) return false;
    this.editor
      .chain()
      .setTextSelection({ from: f.from, to: f.to ?? f.from })
      .setMeta(FOCUS_META, true)
      .run();
    this.picked = { from: f.from, to: f.to ?? f.from };
    return true;
  }

  /** The range the last focus change selected. Esc treats it as the app's
   *  selection, not the author's, so it does not stop Esc entering review. */
  private picked: { from: number; to: number } | null = null;

  /** Esc in writing mode closes one thing at a time: the find bar, then a
   *  selection the author made, which collapses to its end. With neither, it
   *  enters review mode (SPEC §12.4). */
  escape() {
    if (this.find) return this.closeFind(true);
    const editor = this.editor;
    const selection = editor?.state.selection;
    const ours = selection && this.picked?.from === selection.from && this.picked.to === selection.to;
    if (editor && selection && !selection.empty && !ours) {
      editor.commands.setTextSelection(selection.to);
      return;
    }
    this.enterReview();
    (document.activeElement as HTMLElement | null)?.blur();
    if (this.cursor < 0 && this.visible.length > 0) this.step(1);
  }

  scrollToCurrent() {
    if (this.selectCurrent()) this.editor?.commands.scrollIntoView();
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

  // ------------------------------------------------------------------ help

  /** The draft under the sheet must not take the keys typed while the help
   *  is open. A blur is not enough: the selection stays in the draft, and
   *  text input still lands there. So the draft is read-only until the help
   *  closes. No update is emitted, so nothing is marked unsaved. */
  openHelp() {
    this.editor?.setEditable(false, false);
    (document.activeElement as HTMLElement | null)?.blur();
    this.help = true;
  }

  /** Review mode: the single-letter keys act on the focus, so it is lit.
   *  Review mode works in the margin, so a hidden margin comes back. */
  enterReview() {
    this.closeFind(false);
    this.mode = "review";
    this.quiet = false;
    this.showMargin();
  }

  /** ⌃⌘S: hide the margin if it shows, show it if it is hidden (SPEC §12.1). */
  toggleMargin() {
    this.margin = !this.showSidebar;
  }

  /** Undo a hidden margin. The margin then shows when there are findings. */
  showMargin() {
    if (this.margin === false) this.margin = null;
  }

  /** Back to writing, with the margin quiet. */
  leaveReview() {
    this.mode = "write";
    this.quiet = true;
    this.editor?.commands.focus();
  }

  // ------------------------------------------------------------------ find

  /** Open the find bar, with the replace field if asked. The bar belongs to
   *  writing, so review mode ends. A selection within one paragraph becomes
   *  the query. */
  openFind(replace: boolean) {
    const editor = this.editor;
    if (!editor) return;
    if (this.mode === "review") this.leaveReview();
    const selection = editor.state.selection;
    const { from, to } = selection;
    if (from < to && selection.$from.sameParent(selection.$to) && to - from <= 200) {
      const picked = editor.state.doc.textBetween(from, to);
      if (picked.trim()) this.findText = picked;
    }
    this.find = { replace: replace || (this.find?.replace ?? false), seq: (this.find?.seq ?? 0) + 1 };
    this.search(true);
  }

  /** Close the bar and clear its highlights. The match stays selected, and
   *  the caret goes back to the text when asked. */
  closeFind(focusText: boolean) {
    if (!this.find) return;
    this.find = null;
    const editor = this.editor;
    if (!editor) return;
    find.setQuery(editor.state, editor.view.dispatch, "", "", false);
    if (focusText) editor.commands.focus();
  }

  /** Hand the query to the editor. With `select`, the first match at or
   *  after the caret is selected. */
  search(select: boolean) {
    const editor = this.editor;
    if (!editor || !this.find) return;
    find.setQuery(editor.state, editor.view.dispatch, this.findText, this.replaceText, select);
  }

  /** The next or previous match. With the bar closed, open it on the last
   *  query, which selects the next match. */
  findStep(delta: 1 | -1) {
    const editor = this.editor;
    if (!editor) return;
    if (!this.find) return this.openFind(false);
    (delta > 0 ? find.next : find.prev)(editor.state, editor.view.dispatch);
  }

  replaceOne() {
    const editor = this.editor;
    if (!editor || !this.find) return;
    find.replaceOne(editor.state, editor.view.dispatch);
  }

  replaceAll() {
    const editor = this.editor;
    if (!editor) return;
    if (!this.find) this.openFind(true);
    const before = find.count(editor.state).total;
    if (find.replaceEvery(editor.state, editor.view.dispatch)) {
      this.say(`replaced ${before === 1 ? "1 match" : `${before} matches`}`);
    }
  }

  closeHelp() {
    this.help = false;
    this.editor?.setEditable(true, false);
    if (this.mode === "write") this.editor?.commands.focus();
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

/** Marks a selection made by a focus change, not by the caret. */
export const FOCUS_META = "writegood:focus";

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
