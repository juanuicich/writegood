/** Find and replace against a ProseMirror state, with no editor or window
 *  (SPEC §12.6). */
import { describe, expect, test } from "bun:test";
import { Schema } from "@tiptap/pm/model";
import { EditorState, TextSelection, type Transaction } from "@tiptap/pm/state";
import { history, undo } from "@tiptap/pm/history";
import { search } from "prosemirror-search";
import { count, countLabel, next, prev, queryFor, replaceEvery, replaceOne, setQuery } from "./search";

const schema = new Schema({
  nodes: {
    doc: { content: "paragraph+" },
    paragraph: { content: "text*", toDOM: () => ["p", 0] },
    text: {},
  },
});

/** A state over paragraphs, with the search plugin and undo history. */
function editor(...paragraphs: string[]) {
  const doc = schema.node(
    "doc",
    null,
    paragraphs.map((t) => schema.node("paragraph", null, t ? [schema.text(t)] : [])),
  );
  let state = EditorState.create({ doc, plugins: [search(), history()] });
  const dispatch = (tr: Transaction) => {
    state = state.apply(tr);
  };
  return {
    get state() {
      return state;
    },
    dispatch,
    text: () => state.doc.textBetween(0, state.doc.content.size, "\n"),
    selected: () => state.doc.textBetween(state.selection.from, state.selection.to),
    caret(pos: number) {
      dispatch(state.tr.setSelection(TextSelection.create(state.doc, pos)));
    },
  };
}

describe("the query", () => {
  test("ignores case unless it holds a capital letter", () => {
    expect(queryFor("the").caseSensitive).toBe(false);
    expect(queryFor("The").caseSensitive).toBe(true);
    expect(queryFor("émile").caseSensitive).toBe(false);
    expect(queryFor("Émile").caseSensitive).toBe(true);
  });

  test("is literal text, not a pattern", () => {
    const e = editor("a.b axb");
    setQuery(e.state, e.dispatch, "a.b", "", false);
    expect(count(e.state).total).toBe(1);
  });

  test("a lower-case query matches both cases", () => {
    const e = editor("The cat sat on the mat.");
    setQuery(e.state, e.dispatch, "the", "", false);
    expect(count(e.state).total).toBe(2);
    setQuery(e.state, e.dispatch, "The", "", false);
    expect(count(e.state).total).toBe(1);
  });
});

describe("selecting a match", () => {
  test("selects the first match at or after the caret", () => {
    const e = editor("one two one two");
    e.caret(5);
    setQuery(e.state, e.dispatch, "one", "", true);
    expect(e.state.selection.from).toBe(9);
    expect(count(e.state)).toEqual({ total: 2, index: 2 });
  });

  test("wraps to the top when nothing follows the caret", () => {
    const e = editor("one two", "two");
    e.caret(e.state.doc.content.size - 1);
    setQuery(e.state, e.dispatch, "one", "", true);
    expect(count(e.state)).toEqual({ total: 1, index: 1 });
  });

  test("a query that grows keeps its match", () => {
    const e = editor("then the end");
    e.caret(5);
    setQuery(e.state, e.dispatch, "th", "", true);
    const at = e.state.selection.from;
    setQuery(e.state, e.dispatch, "the", "", true);
    expect(e.state.selection.from).toBe(at);
    expect(e.selected()).toBe("the");
  });

  test("next and previous step and wrap", () => {
    const e = editor("a b a b a");
    e.caret(1);
    setQuery(e.state, e.dispatch, "a", "", true);
    expect(count(e.state).index).toBe(1);
    next(e.state, e.dispatch);
    next(e.state, e.dispatch);
    expect(count(e.state).index).toBe(3);
    next(e.state, e.dispatch);
    expect(count(e.state).index).toBe(1);
    prev(e.state, e.dispatch);
    expect(count(e.state).index).toBe(3);
  });

  test("an empty query matches nothing", () => {
    const e = editor("text");
    setQuery(e.state, e.dispatch, "", "", true);
    expect(count(e.state)).toEqual({ total: 0, index: 0 });
  });
});

describe("the count", () => {
  test("words the state", () => {
    expect(countLabel({ total: 0, index: 0 })).toBe("no matches");
    expect(countLabel({ total: 1, index: 0 })).toBe("1 match");
    expect(countLabel({ total: 12, index: 0 })).toBe("12 matches");
    expect(countLabel({ total: 12, index: 3 })).toBe("3 of 12");
  });
});

describe("replacing", () => {
  test("replaces the selected match and selects the next", () => {
    const e = editor("red and red and red");
    e.caret(1);
    setQuery(e.state, e.dispatch, "red", "blue", true);
    replaceOne(e.state, e.dispatch);
    expect(e.text()).toBe("blue and red and red");
    expect(e.selected()).toBe("red");
    expect(count(e.state)).toEqual({ total: 2, index: 1 });
  });

  test("with no match selected, only selects the next", () => {
    const e = editor("red and red");
    setQuery(e.state, e.dispatch, "red", "blue", false);
    e.caret(4);
    replaceOne(e.state, e.dispatch);
    expect(e.text()).toBe("red and red");
    expect(e.state.selection.from).toBe(9);
  });

  test("replace all is one undo step", () => {
    const e = editor("red and red", "red");
    setQuery(e.state, e.dispatch, "red", "blue", false);
    replaceEvery(e.state, e.dispatch);
    expect(e.text()).toBe("blue and blue\nblue");
    undo(e.state, e.dispatch);
    expect(e.text()).toBe("red and red\nred");
  });

  test("each replacement is its own undo step", () => {
    const e = editor("red and red");
    e.caret(1);
    setQuery(e.state, e.dispatch, "red", "blue", true);
    replaceOne(e.state, e.dispatch);
    replaceOne(e.state, e.dispatch);
    expect(e.text()).toBe("blue and blue");
    undo(e.state, e.dispatch);
    expect(e.text()).toBe("blue and red");
  });

  test("an empty replacement deletes the match", () => {
    const e = editor("very very good");
    setQuery(e.state, e.dispatch, "very ", "", false);
    replaceEvery(e.state, e.dispatch);
    expect(e.text()).toBe("good");
  });
});
