/** The regression these guard: a focus change used to rebuild every
 *  decoration from the offsets the store held, which after an edit were
 *  stale. A highlight then jumped onto the wrong words. */
import { describe, expect, test } from "bun:test";
import { Schema } from "@tiptap/pm/model";
import { EditorState } from "@tiptap/pm/state";
import { build, refocus, type Mark } from "./findings";

const schema = new Schema({
  nodes: {
    doc: { content: "paragraph+" },
    paragraph: { content: "text*", toDOM: () => ["p", 0] },
    text: {},
  },
});

/** One paragraph. "AAAA BBBB CCCC" — the mark covers "CCCC". */
function docWith(text: string) {
  return schema.node("doc", null, [schema.node("paragraph", null, [schema.text(text)])]);
}

const marks: Mark[] = [
  { id: 7, from: 11, to: 15, severity: "high", stale: false, current: false },
];

describe("finding decorations", () => {
  test("build places a mark where the store says", () => {
    const set = build(docWith("AAAA BBBB CCCC"), marks);
    const [deco] = set.find();
    expect([deco.from, deco.to]).toEqual([11, 15]);
    expect(deco.spec).toMatchObject({ id: 7, current: false });
  });

  test("a focus change keeps the mapped position, not the stored one", () => {
    const state = EditorState.create({ doc: docWith("AAAA BBBB CCCC") });
    let set = build(state.doc, marks);

    // Delete "AAAA " — five characters ahead of the mark.
    const tr = state.tr.delete(1, 6);
    set = set.map(tr.mapping, tr.doc);
    expect(set.find().map((d) => [d.from, d.to])).toEqual([[6, 10]]);

    // Focusing the finding must not drag it back to 11..15.
    set = refocus(set, tr.doc, [7]);
    const [deco] = set.find();
    expect([deco.from, deco.to]).toEqual([6, 10]);
    expect(deco.spec).toMatchObject({ id: 7, current: true });
  });

  test("focusing another finding clears the current flag", () => {
    let set = build(docWith("AAAA BBBB CCCC"), marks);
    set = refocus(set, docWith("AAAA BBBB CCCC"), [7]);
    expect(set.find()[0].spec).toMatchObject({ current: true });
    set = refocus(set, docWith("AAAA BBBB CCCC"), [99]);
    expect(set.find()[0].spec).toMatchObject({ current: false });
  });

  test("several findings can be lit at once", () => {
    const three: Mark[] = [
      { id: 1, from: 1, to: 5, severity: "low", stale: false, current: false },
      { id: 2, from: 3, to: 10, severity: "high", stale: false, current: false },
      { id: 3, from: 11, to: 15, severity: "medium", stale: false, current: false },
    ];
    const doc = docWith("AAAA BBBB CCCC");
    const set = refocus(build(doc, three), doc, [1, 2]);
    const lit = Object.fromEntries(set.find().map((d) => [d.spec.id, d.spec.current]));
    expect(lit).toEqual({ 1: true, 2: true, 3: false });
  });

  test("a mark outside the document is dropped", () => {
    const set = build(docWith("short"), marks);
    expect(set.find()).toHaveLength(0);
  });
});
