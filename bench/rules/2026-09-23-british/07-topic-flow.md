+++
# A starting point. Replace this prompt with your own wording.
name = "Topic flow"
category = "topic-flow"
scope = "paragraph"
enabled = true
+++

Check the link from each sentence to the sentences before it, inside each
paragraph. A sentence should open with something the reader already has, and
end with what is new. Report two kinds of break.

1. Unprepared opening: the sentence opens on a person, thing or idea that the
   reader cannot connect to anything before it. The clearest case is an aside:
   the sentence leaves the paragraph's line of thought, and the next sentence
   continues from the sentence before the aside, as if the aside were not
   there. A loose link through one word does not make an aside part of the
   line.
2. Drifting subjects: three or more consecutive sentences whose subjects change
   each time with no shared term, so the reader cannot tell what the passage
   is about.

The test: read the sentence up to and including its subject. Ask whether a
reader who has read the draft up to this point knows how that opening relates
to what came before. Flag the sentence only when the reader must stop, or read
on, to find the connection.

An opening is linked, and you must not flag it, when it is one of these:
- Something the draft has already named, in this paragraph or an earlier one:
  a person, a place, a thing or an event. The narrator ('I', 'my', 'we') is
  always linked.
- A part, a feature or a result of something already named: 'We bought a new
  printer. The tray jams on thick paper.'
- The next event in a sequence, or a phrase of time or place that moves the
  sequence on: 'At noon', 'Later that week', 'The next morning'.
- Another item of the same kind as one just named, as in a list or a
  comparison: one price after another price, one team after another team.
- A general statement drawn from the case before it, or an example of the
  general statement before it.
- A contrast with the sentence before, stated or clear from the content.
- A pronoun, a repeated term or a clear transition: 'By contrast', 'For
  example'.

Flag: 'The server restarts every night. Customs rules for Norway changed in
May.' Flag the aside: 'We loaded the van on Friday. Oak is harder to cut than
pine. On Saturday we drove to the site.' Do not flag: 'The server restarts
every night. The restart clears the cache.'

Do not flag:
- The first sentence of a paragraph or a section. The paragraph-order pass
  judges links between paragraphs.
- A sentence whose opening is linked as above, only because its link to the
  sentence before comes after the subject.
- A passive or impersonal opening, such as 'It was decided'. The
  missing-actor pass reports hidden actors.
- Lists, headings, quotations and dialogue.
- The form or length of an opening. The sentence-openings pass reports runs of
  identical openings and long phrases before the subject.

Quote the opening of the sentence up to and including its subject. For
drifting subjects, report one finding, at the sentence where the chain breaks.
Copy the quote character for character, within one paragraph. Avoid Markdown
characters such as ** or * where you can.

Severity is low, medium or high. No other value is allowed.
- high: an aside, or a sentence the reader cannot relate to the one before.
- medium: the opening is unprepared, and the link to what came before comes
  only later in the sentence.
- low: the reader finds the connection after a moment, but nothing before
  named or implied the element at the opening.

The note is one or two short sentences. Name the new element at the opening and
what the previous sentence was about. Never rewrite a sentence, suggest an
order, or praise.

Set category to 'topic-flow'. Examine every paragraph. Most paragraphs have
none. If you find none, return an empty array. Do not pad the list.
