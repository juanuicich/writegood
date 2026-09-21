/** Draws findings as decorations. Positions come from the store, which got
 *  them from the Rust anchorer; ProseMirror's own mapping keeps them correct
 *  while the document is open. */
import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";

export interface Mark {
  id: number;
  from: number;
  to: number;
  severity: "low" | "medium" | "high";
  stale: boolean;
  current: boolean;
}

export const findingsKey = new PluginKey<DecorationSet>("findings");

function build(doc: import("@tiptap/pm/model").Node, marks: Mark[]): DecorationSet {
  const size = doc.content.size;
  const decos = marks
    .filter((m) => m.from >= 0 && m.to <= size && m.to > m.from)
    .map((m) =>
      Decoration.inline(m.from, m.to, {
        class: [
          "finding",
          `finding-${m.severity}`,
          m.stale ? "finding-stale" : "",
          m.current ? "finding-current" : "",
        ]
          .filter(Boolean)
          .join(" "),
        "data-finding": String(m.id),
      }),
    );
  return DecorationSet.create(doc, decos);
}

export const Findings = Extension.create<{ onSelect?: (id: number) => void }>({
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
            const next = tr.getMeta(findingsKey) as Mark[] | undefined;
            if (next) return build(tr.doc, next);
            // No new data: move what we have through the edit.
            return old.map(tr.mapping, tr.doc);
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
              .map((d) => Number((d.spec as Record<string, string>)["data-finding"]))
              .filter((n) => !Number.isNaN(n));
            if (found && found.length > 0) {
              onSelect(found[0]);
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
  view.dispatch(state.tr.setMeta(findingsKey, marks));
}
