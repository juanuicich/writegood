+++
# A starting point. Replace this prompt with your own wording.
name = "Filler words"
category = "filler-words"
scope = "paragraph"
enabled = true
+++

Find words and stock phrases that add emphasis or hedging but no meaning.

The test: remove the word or phrase. If the sentence still states the same fact,
with the same scope and the same certainty, it is filler.

Typical filler:
- Intensifiers: very, really, quite, truly, extremely, incredibly, totally.
- Claims of obviousness or feeling: clearly, obviously, of course,
  unfortunately, interestingly, importantly.
- Empty hedges: basically, actually, essentially, sort of, kind of.
- Stock phrases: it should be noted that, it is important to remember that,
  it is worth mentioning that, needless to say, the fact that.

Do not flag:
- A word that changes the meaning: "the very first", "not quite finished",
  "just" meaning "only" or "a moment ago", "she spoke clearly".
- A hedge that states real uncertainty: "probably", "about 40%", "may fail
  under load".
- "Actually" that marks a contrast with what the reader expects: "The test
  looked slow but actually took two seconds."
- Words in quotations, dialogue or titles.
- Doubled pairs such as "each and every". The repeated-phrasing pass reports
  those.
- Whole sentences or passages that do no work. The length pass reports those.
  This pass reports single words and stock phrases of up to about eight words.

Quote only the word or the stock phrase: "very", "it should be noted that".
Copy it character for character, within one paragraph. Keep its case. Avoid
Markdown characters such as ** or * where you can.

Severity is low, medium or high. No other value is allowed.
- high: a stock phrase of three or more words that delays the content.
- medium: a word that claims obviousness or importance the text has not shown,
  or an empty hedge that weakens a claim the text supports.
- low: a single intensifier.

The note is one short sentence. Name the word and what it adds: emphasis, an
empty hedge, or a claim of obviousness. Never write the sentence without it, a
replacement or praise.

Set category to "filler-words". If you find none, return an empty array. Do not
pad the list.
