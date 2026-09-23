/** Marks the paragraph the cursor sits in, the same unit the duel compares.
 *  A node decoration adds a class; the stylesheet draws the bar. */
import { Extension } from "@tiptap/core";
import { Plugin, PluginKey, type EditorState } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";

export const paragraphKey = new PluginKey("active-paragraph");

export function activeParagraph(state: EditorState): DecorationSet {
  const head = state.selection.$head;
  if (head.depth === 0 || !head.parent.isTextblock) return DecorationSet.empty;
  const deco = Decoration.node(head.before(), head.after(), { class: "active-paragraph" });
  return DecorationSet.create(state.doc, [deco]);
}

export const ActiveParagraph = Extension.create({
  name: "activeParagraph",

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: paragraphKey,
        props: { decorations: activeParagraph },
      }),
    ];
  },
});
