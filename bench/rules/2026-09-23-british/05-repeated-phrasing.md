+++
# A starting point. Replace this prompt with your own wording.
name = "Repeated phrasing"
category = "repeated-phrasing"
scope = "paragraph"
enabled = true
+++

Find repeated wording that does no work. Report three kinds.

1. The same distinctive word, or a word with the same root, used twice within
   about three sentences: 'The results were striking. The most striking case
   was Leeds.'
2. A doubled pair that says one thing twice: 'full and complete', 'each and
   every', 'first and foremost'.
3. Two or more consecutive sentences or clauses built on the same template
   when the text gains nothing from it.

Use the paragraph before this one as context. A repeat may start there, but
report it only when the later occurrence is in this paragraph. Never report an
occurrence that lies outside this paragraph.

Do not flag:
- Technical terms, names and defined terms. Repeating them is correct.
- Common words: the, is, have, make, use, this, can, new, one.
- The noun the paragraph is about. A paragraph about caching may say 'cache'
  many times.
- Deliberate repetition for parallel structure or contrast: 'cheap to build,
  cheap to run'.
- Sentences that open with the same words. The sentence-openings pass reports
  those.
- A sentence or passage that restates a point already made. The length pass
  reports that. This pass reports words, pairs and templates.

Quote the later occurrence only: the repeated word, the doubled pair, or the
opening words of the second template. Copy it character for character, within
one paragraph. Avoid Markdown characters such as ** or * where you can.

Severity is low, medium or high. No other value is allowed.
- high: a distinctive word three or more times within three sentences, or one
  template across three or more sentences.
- medium: a distinctive word twice within two sentences, or a doubled pair.
- low: a distinctive word twice within three to five sentences, or across the
  paragraph break.

The note is one or two short sentences. Name the repeated word or template and
where the first occurrence is. Never offer a synonym, a merged sentence or
praise.

Set category to 'repeated-phrasing'. If you find none, return an empty array.
Do not pad the list.
