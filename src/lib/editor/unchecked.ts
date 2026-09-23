/** Marks the paragraphs that are not checked, in review mode (SPEC §12.4).
 *
 *  A node decoration adds a class to the textblock, and the stylesheet draws
 *  a dot in the left gutter. The set maps through every transaction, so a
 *  dot stays on its block while the document changes. `setUnchecked`
 *  replaces the set, and an empty list removes every dot. */
import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import type { Node } from "@tiptap/pm/model";
import type { TextIndex } from "../text";
import { paragraphStarts } from "../passes/parse";

/** A textblock, as the ProseMirror positions before and after it. */
export interface Block {
  from: number;
  to: number;
}

export const uncheckedKey = new PluginKey<DecorationSet>("unchecked");

/** The textblock of each paragraph the runner sees, in the runner's order.
 *  A paragraph belongs to the block that holds its first character. Two
 *  paragraphs can share a block when a block holds a blank line made of
 *  hard breaks. */
export function paragraphBlocks(doc: Node, index: TextIndex): Block[] {
  return paragraphStarts(index.text).map((start) => {
    const $pos = doc.resolve(index.pos[start]!);
    return { from: $pos.before(), to: $pos.after() };
  });
}

export function build(doc: Node, blocks: Block[]): DecorationSet {
  const size = doc.content.size;
  // One decoration per block, however many paragraphs share it.
  const unique = new Map<number, Block>();
  for (const b of blocks) if (b.from >= 0 && b.to <= size && b.to > b.from) unique.set(b.from, b);
  const decos = [...unique.values()].map((b) => Decoration.node(b.from, b.to, { class: "unchecked" }));
  return DecorationSet.create(doc, decos);
}

export const Unchecked = Extension.create({
  name: "unchecked",

  addProseMirrorPlugins() {
    return [
      new Plugin<DecorationSet>({
        key: uncheckedKey,
        state: {
          init: () => DecorationSet.empty,
          apply(tr, old) {
            const blocks = tr.getMeta(uncheckedKey) as Block[] | undefined;
            if (blocks) return build(tr.doc, blocks);
            return old.map(tr.mapping, tr.doc);
          },
        },
        props: {
          decorations(state) {
            return uncheckedKey.getState(state);
          },
        },
      }),
    ];
  },
});

/** Replace the markers. An empty list removes them. */
export function setUnchecked(editor: import("@tiptap/core").Editor, blocks: Block[]) {
  const { state, view } = editor;
  view.dispatch(state.tr.setMeta(uncheckedKey, blocks));
}
