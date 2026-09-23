/** The markers find a paragraph's block through the text index, whose
 *  offsets are code points. An astral character before a paragraph takes
 *  two ProseMirror positions and one code point, so a mapping that counted
 *  UTF-16 units would land on the wrong block. */
import { describe, expect, test } from "bun:test";
import { Schema } from "@tiptap/pm/model";
import { EditorState } from "@tiptap/pm/state";
import { buildTextIndex } from "../text";
import { paragraphs } from "../passes/parse";
import { build, paragraphBlocks, uncheckedKey, Unchecked } from "./unchecked";

const schema = new Schema({
  nodes: {
    doc: { content: "block+" },
    paragraph: { group: "block", content: "inline*", toDOM: () => ["p", 0] },
    heading: { group: "block", content: "inline*", toDOM: () => ["h1", 0] },
    hardBreak: { group: "inline", inline: true, toDOM: () => ["br"] },
    text: { group: "inline" },
  },
});

const p = (text: string) => schema.node("paragraph", null, text ? [schema.text(text)] : []);

describe("paragraph blocks", () => {
  test("each paragraph maps to the block that holds its first character", () => {
    const doc = schema.node("doc", null, [schema.node("heading", null, [schema.text("Title")]), p("One."), p("Two.")]);
    const index = buildTextIndex(doc);
    const blocks = paragraphBlocks(doc, index);
    expect(paragraphs(index.text)).toEqual(["Title", "One.", "Two."]);
    const starts: number[] = [];
    doc.forEach((_node, offset) => starts.push(offset));
    expect(blocks.map((b) => b.from)).toEqual(starts);
    expect(blocks.map((b) => doc.nodeAt(b.from)!.textContent)).toEqual(["Title", "One.", "Two."]);
  });

  test("an astral character before a paragraph does not shift the mapping", () => {
    const doc = schema.node("doc", null, [p("A 🦊 fox, 𝒳, and 😀."), p("Second 🦊."), p("Third.")]);
    const blocks = paragraphBlocks(doc, buildTextIndex(doc));
    expect(blocks.map((b) => doc.nodeAt(b.from)!.textContent)).toEqual(["A 🦊 fox, 𝒳, and 😀.", "Second 🦊.", "Third."]);
    for (const b of blocks) expect(b.to).toBe(b.from + doc.nodeAt(b.from)!.nodeSize);
  });

  test("empty blocks are not paragraphs", () => {
    const doc = schema.node("doc", null, [p("One."), p(""), p(""), p("Two.")]);
    const blocks = paragraphBlocks(doc, buildTextIndex(doc));
    expect(blocks.map((b) => doc.nodeAt(b.from)!.textContent)).toEqual(["One.", "Two."]);
  });

  test("two paragraphs split by hard breaks share one block and one marker", () => {
    const br = () => schema.node("hardBreak");
    const doc = schema.node("doc", null, [schema.node("paragraph", null, [schema.text("One."), br(), br(), schema.text("Two.")])]);
    const blocks = paragraphBlocks(doc, buildTextIndex(doc));
    expect(blocks).toHaveLength(2);
    expect(blocks[0]).toEqual(blocks[1]!);
    expect(build(doc, blocks).find()).toHaveLength(1);
  });
});

describe("marker decorations", () => {
  test("a marker stays on its block through an edit and a meta replaces the set", () => {
    const plugin = Unchecked.config.addProseMirrorPlugins!.call({} as never)[0]!;
    const doc = schema.node("doc", null, [p("One."), p("Two.")]);
    let state = EditorState.create({ doc, plugins: [plugin] });
    const second = paragraphBlocks(doc, buildTextIndex(doc))[1]!;
    state = state.apply(state.tr.setMeta(uncheckedKey, [second]));
    // Typing into the first paragraph moves the second one along.
    state = state.apply(state.tr.insertText("Zero. ", 1));
    const [deco] = uncheckedKey.getState(state)!.find();
    expect(state.doc.nodeAt(deco!.from)!.textContent).toBe("Two.");
    state = state.apply(state.tr.setMeta(uncheckedKey, []));
    expect(uncheckedKey.getState(state)!.find()).toHaveLength(0);
  });
});
