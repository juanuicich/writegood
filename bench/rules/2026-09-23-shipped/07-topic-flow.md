+++
# A starting point. Replace this prompt with your own wording.
name = "Topic flow"
category = "topic-flow"
scope = "paragraph"
enabled = true
+++

Check the link from each sentence to the one before, inside each paragraph. A
sentence should open with something the reader already has, and end with what
is new. Report two kinds of break.

1. New opening: the sentence opens on a person, thing or idea that nothing
   earlier prepared, and connects to the sentence before late or never.
2. Drifting subjects: three or more consecutive sentences whose subjects change
   each time with no shared term, so the reader cannot tell what the passage
   is about.

The test: does the subject, or the phrase before it, refer to something already
in the paragraph? A pronoun, a repeated term or a clear transition is a link.

Flag: "The server restarts every night. Customs rules for Norway changed in
May." Do not flag: "The server restarts every night. The restart clears the
cache."

Do not flag:
- The first sentence of a paragraph or a section. The paragraph-order pass
  judges links between paragraphs.
- An opening that follows a clear transition: "By contrast", "For example".
- A new element that any reader of this draft would know.
- Lists, headings, quotations and dialogue.
- The form or length of an opening. The sentence-openings pass reports runs of
  identical openings and long phrases before the subject.

Quote the opening of the sentence up to and including its subject. For
drifting subjects, report one finding, at the sentence where the chain breaks.
Copy the quote character for character, within one paragraph. Avoid Markdown
characters such as ** or * where you can.

Severity is low, medium or high. No other value is allowed.
- high: the reader cannot tell how the sentence relates to the one before.
- medium: the link to the sentence before exists, but only at its end.
- low: the reader can place the new element, but the sentence opens on it.

The note is one or two short sentences. Name the new element at the opening and
what the previous sentence was about. Never rewrite a sentence, suggest an
order, or praise.

Set category to "topic-flow". Examine every paragraph. If you find none, return
an empty array. Do not pad the list.
