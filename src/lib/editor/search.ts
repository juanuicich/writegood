/** Find and replace (SPEC §12.6). `prosemirror-search` does the matching and
 *  draws the matches. This file builds the query the way the app wants it and
 *  wraps the commands so a replacement is its own undo step. */
import { Extension } from "@tiptap/core";
import { Plugin, TextSelection, type EditorState, type Transaction } from "@tiptap/pm/state";
import { closeHistory } from "@tiptap/pm/history";
import {
  findNext,
  findPrev,
  getSearchState,
  replaceAll,
  replaceNext,
  search,
  SearchQuery,
  setSearchState,
} from "prosemirror-search";

type Dispatch = (tr: Transaction) => void;

/** The search plugin, and a scroll margin that keeps a match found by the
 *  bar from landing under it. `top` is read on every scroll, so it follows
 *  the bar opening and closing. */
export const Search = Extension.create<{ top: () => number }>({
  name: "search",

  addOptions() {
    return { top: () => 0 };
  },

  addProseMirrorPlugins() {
    const top = this.options.top;
    return [
      search(),
      new Plugin({
        props: {
          get scrollMargin() {
            return { top: Math.max(5, top()), bottom: 5, left: 5, right: 5 };
          },
        },
      }),
    ];
  },
});

/** Literal text. Case is ignored unless the query holds a capital letter. */
export function queryFor(text: string, replace = ""): SearchQuery {
  return new SearchQuery({ search: text, replace, literal: true, caseSensitive: /\p{Lu}/u.test(text) });
}

/** Set the query. With `select`, the first match at or after the start of
 *  the selection is selected, wrapping to the top, so a query that grows by
 *  a letter keeps the match it had. */
export function setQuery(state: EditorState, dispatch: Dispatch, text: string, replace: string, select: boolean) {
  const query = queryFor(text, replace);
  const tr = setSearchState(state.tr, query);
  if (select && query.valid) {
    const from = state.selection.from;
    const hit = query.findNext(state, from) ?? query.findNext(state, 0, from);
    if (hit) tr.setSelection(TextSelection.create(state.doc, hit.from, hit.to)).scrollIntoView();
  }
  dispatch(tr);
}

/** How many matches there are, and which of them is selected, counting from
 *  one. Zero means the selection is on none of them. */
export function count(state: EditorState): { total: number; index: number } {
  const s = getSearchState(state);
  if (!s || !s.query.valid) return { total: 0, index: 0 };
  const { from, to } = state.selection;
  let total = 0;
  let index = 0;
  for (let pos = 0; ; ) {
    const hit = s.query.findNext(state, pos);
    if (!hit) break;
    total += 1;
    if (hit.from === from && hit.to === to) index = total;
    pos = Math.max(hit.to, pos + 1);
  }
  return { total, index };
}

/** "3 of 12", "12 matches" when the selection is on none, or "no matches". */
export function countLabel({ total, index }: { total: number; index: number }): string {
  if (total === 0) return "no matches";
  if (index > 0) return `${index} of ${total}`;
  return total === 1 ? "1 match" : `${total} matches`;
}

export function next(state: EditorState, dispatch: Dispatch): boolean {
  return findNext(state, dispatch);
}

export function prev(state: EditorState, dispatch: Dispatch): boolean {
  return findPrev(state, dispatch);
}

/** Replace the selected match and select the next. With no match selected,
 *  select the next one. A replacement starts its own undo step, so a burst
 *  of them is not undone as one. */
export function replaceOne(state: EditorState, dispatch: Dispatch): boolean {
  return replaceNext(state, (tr) => dispatch(tr.docChanged ? closeHistory(tr) : tr));
}

/** Replace every match, as one undo step. */
export function replaceEvery(state: EditorState, dispatch: Dispatch): boolean {
  return replaceAll(state, (tr) => dispatch(closeHistory(tr)));
}
