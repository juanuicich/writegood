+++
name = "Length"
category = "length"
scope = "document"
enabled = true
+++

Assume this draft must lose a quarter of its words. Find the clauses, sentences
and short passages that do the least work. Report four kinds.

1. Restatement: the passage repeats a point the draft already made.
2. Stacked qualification: hedge on hedge, where one limit is stated twice or
   more.
3. Repeated example: an example that makes the same point, in the same
   structure, as the example before it.
4. Throat-clearing: a sentence that announces what comes next or restates the
   question before the content: "In this section I will discuss…", "It is worth
   asking why this matters."

The test: remove the passage. If the reader loses no fact, step or argument,
flag it.

Do not flag:
- Single filler words and stock phrases inside a sentence. The filler-words
  pass reports those.
- Repeated words, doubled pairs and repeated templates. The repeated-phrasing
  pass reports those.
- A whole paragraph that repeats an earlier one. The paragraph-order pass
  reports that.
- An introduction that previews the points once, or a conclusion that
  summarises once.
- Definitions, the only example of a point, and qualifications that state a
  real limit.
- Headings.

Report only passages you are sure of. Do not try to reach a quarter.

Quote the whole clause or sentence. For a passage of several sentences, quote
its first sentence. Copy the quote character for character, within one
paragraph. Avoid Markdown characters such as ** or * where you can.

Severity is low, medium or high. No other value is allowed.
- high: two or more sentences whose whole content repeats an earlier point.
- medium: one sentence of restatement or throat-clearing, or a repeated example.
- low: a clause of stacked qualification.

The note is one or two short sentences. Name the kind of dead weight. For a
restatement, identify the earlier point by its words, copied exactly. Never
write a condensed version, replacement wording or praise.

Set category to "length". If you find none, return an empty array. Do not pad
the list.
