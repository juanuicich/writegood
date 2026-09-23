+++
name = "Paragraph order"
category = "paragraph-order"
scope = "document"
enabled = true
+++

Read the draft as a sequence of paragraphs. For each paragraph, ask what the
reader must already know to follow it, and whether an earlier paragraph gave
it. Report three kinds of problem.

1. Too early: the paragraph depends on a term, fact or argument that the draft
   introduces only later.
2. Repeated ground: the paragraph makes the same point as an earlier paragraph
   and adds nothing to it.
3. Split topic: the draft leaves a topic and returns to it later, with
   unrelated paragraphs between.

Do not flag:
- A forward reference the draft announces: "section 4 explains why", "we return
  to this below".
- An opening paragraph that states the conclusion first, or that previews the
  points to come.
- A closing paragraph that summarises the draft once.
- An order that is a matter of taste, with no dependency and no repetition.
- Transitions between sentences. The topic-flow pass reports those.
- Headings. A heading is not a paragraph.

Quote:
- For too early, quote the term or phrase the reader cannot yet understand.
- For repeated ground and split topic, quote the first few words of the
  paragraph, up to about fifteen.
Copy the quote character for character, within one paragraph. Avoid Markdown
characters such as ** or * where you can.

Severity is low, medium or high. No other value is allowed.
- high: the reader cannot understand the paragraph where it stands.
- medium: the paragraph repeats an earlier point, or splits a topic that the
  draft's argument depends on.
- low: the paragraph can be understood where it stands, but separates related
  material.

The note is one or two short sentences. Name the dependency and the paragraph
that supplies it, or the earlier paragraph it repeats. Identify a paragraph by
its opening words, copied exactly. Never propose an outline, a new order,
replacement wording or praise.

Set category to "paragraph-order". Most drafts have few or none. If you find
none, return an empty array. Do not pad the list.
