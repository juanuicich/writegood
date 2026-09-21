/** One store for the whole app. Small enough that splitting it would cost more
 *  than it saves. */
import type { Editor } from "@tiptap/core";
import {
  cfg,
  files,
  store,
  anchors as anchorApi,
  type Config,
  type DocSummary,
  type DocumentRow,
  type Finding,
  type Pass,
  type Paths,
} from "./ipc";
import { buildTextIndex, codePointRangeToPM, type TextIndex } from "./text";
import { markdownToJSON, jsonToMarkdown } from "./markdown";

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
  revealed = $state<number[]>([]);
  dirty = $state(false);
  busy = $state(0);
  paletteOpen = $state(false);
  sidebarForced = $state(false);

  /** Only open findings are worth stepping through. */
  visible = $derived(
    this.findings.filter((f) => f.status === "open" || f.status === "addressed"),
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
    this.cursor = (this.cursor + delta + n) % n;
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
