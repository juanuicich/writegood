/** Draws findings as decorations.
 *
 *  Positions arrive from the store, which got them from the Rust anchorer.
 *  While the document is open ProseMirror's own mapping keeps them correct
 *  through every edit, so the mapped positions are better than the stored
 *  ones until the store re-anchors.
 *
 *  That is why there are two messages. `setFindings` carries positions and
 *  replaces the set. `setFocus` changes which finding is highlighted and
 *  keeps every position where the mapping put it. Rebuilding the whole set
 *  on a focus change used to paint the stored offsets back over the mapped
 *  ones, which moved a highlight onto the wrong words after an edit. */
import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import type { Node } from "@tiptap/pm/model";

export interface Mark {
  id: number;
  from: number;
  to: number;
  severity: "low" | "medium" | "high";
  stale: boolean;
  current: boolean;
}

/** What each decoration remembers about itself, so a focus change can redraw
 *  it without consulting the store again. */
type Spec = Omit<Mark, "from" | "to">;

type Message =
  | { kind: "marks"; marks: Mark[] }
  | { kind: "focus"; ids: number[] };

export const findingsKey = new PluginKey<DecorationSet>("findings");

/** Where findings overlap, ProseMirror draws one span for the shared text.
 *  It joins the classes of every decoration there but keeps only one value
 *  of any other attribute, so `data-finding` names one of them. The id
 *  classes survive the join, and say which findings cover a span and which
 *  of those are lit. */
function attrs(spec: Spec) {
  return {
    class: [
      "finding",
      `finding-${spec.severity}`,
      `finding-id-${spec.id}`,
      spec.stale ? "finding-stale" : "",
      spec.current ? `finding-current finding-lit-${spec.id}` : "",
    ]
      .filter(Boolean)
      .join(" "),
    "data-finding": String(spec.id),
  };
}

export function build(doc: Node, marks: Mark[]): DecorationSet {
  const size = doc.content.size;
  const decos = marks
    .filter((m) => m.from >= 0 && m.to <= size && m.to > m.from)
    .map(({ from, to, ...spec }) => Decoration.inline(from, to, attrs(spec), spec));
  return DecorationSet.create(doc, decos);
}

/** Redraw the set the mapping already holds, changing only which ones are
 *  lit. Positions are taken from the decorations, never from the store. */
export function refocus(set: DecorationSet, doc: Node, ids: number[]): DecorationSet {
  const decos = set.find().map((d) => {
    const spec = { ...(d.spec as Spec), current: ids.includes((d.spec as Spec).id) };
    return Decoration.inline(d.from, d.to, attrs(spec), spec);
  });
  return DecorationSet.create(doc, decos);
}

/** A click hands over every finding under the pointer, so overlapping
 *  findings light up together (SPEC §12.3). */
export const Findings = Extension.create<{ onSelect?: (ids: number[]) => void }>({
  name: "findings",

  addOptions() {
    return { onSelect: undefined };
  },

  addProseMirrorPlugins() {
    const onSelect = this.options.onSelect;
    return [
      new Plugin<DecorationSet>({
        key: findingsKey,
        state: {
          init: () => DecorationSet.empty,
          apply(tr, old) {
            // Move what we have through the edit first, so a focus change
            // that rides along with a transaction keeps the new positions.
            const mapped = old.map(tr.mapping, tr.doc);
            const message = tr.getMeta(findingsKey) as Message | undefined;
            if (!message) return mapped;
            if (message.kind === "marks") return build(tr.doc, message.marks);
            return refocus(mapped, tr.doc, message.ids);
          },
        },
        props: {
          decorations(state) {
            return findingsKey.getState(state);
          },
          handleClick(view, pos) {
            if (!onSelect) return false;
            const found = findingsKey
              .getState(view.state)
              ?.find(pos, pos)
              .map((d) => (d.spec as Spec)?.id)
              .filter((id): id is number => typeof id === "number");
            if (found && found.length > 0) {
              onSelect([...new Set(found)]);
              return true;
            }
            return false;
          },
        },
      }),
    ];
  },
});

/** Replace the decoration set. Called whenever the store re-anchors. */
export function setFindings(editor: import("@tiptap/core").Editor, marks: Mark[]) {
  const { state, view } = editor;
  view.dispatch(state.tr.setMeta(findingsKey, { kind: "marks", marks } satisfies Message));
}

/** Light other findings without moving any of them. */
export function setFocus(editor: import("@tiptap/core").Editor, ids: number[]) {
  const { state, view } = editor;
  view.dispatch(state.tr.setMeta(findingsKey, { kind: "focus", ids } satisfies Message));
}
