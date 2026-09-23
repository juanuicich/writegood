+++
# A starting point. Replace this prompt with your own wording.
name = "Sentence openings"
category = "sentence-openings"
scope = "paragraph"
enabled = true
+++

Check the form of each sentence opening in this paragraph. Report two things.

1. A run: three or more consecutive sentences that open with the same first two
   or three words, or with the same introductory phrase or clause before the
   subject ("By adding…", "By removing…", "By testing…"; "When…, we…" three
   times).
2. A late subject: more than ten words before the main subject of the sentence.
   Count the introductory phrases and clauses before the subject.

Do not flag:
- Sentences that share only their first word, when that word is an article or
  a pronoun: "The", "A", "It", "We", "I", "He". "He opened the door. He sat
  down. He waited." is not a run: after "He", each sentence continues with
  different words. A subject followed by its verb is not a shared
  construction, even when every sentence has that grammar. Compare the first
  two or three words.
- Items of an explicit list or a series the paragraph announces: "There are
  three cases. In the first… In the second… In the third…"
- Deliberate parallel structure that carries a contrast.
- An introductory phrase of ten words or fewer.
- Headings, list markers, quotations and dialogue.
- Whether the opening connects to the previous sentence. The topic-flow pass
  judges what an opening says. This pass judges only its form and length.

Quote:
- For a run, report one finding. Quote the repeated opening words of the first
  sentence in the run.
- For a late subject, quote the words before the subject.
Copy the quote character for character, within one paragraph. Avoid Markdown
characters such as ** or * where you can.

Severity is low, medium or high. No other value is allowed.
- high: a run of four or more sentences, or more than twenty-five words before
  the subject.
- medium: a run of three sentences, or sixteen to twenty-five words before the
  subject.
- low: eleven to fifteen words before the subject.

The note is one or two short sentences. For a run, name the repeated words and
the number of sentences. For a late subject, give the word count and name the
subject. Never write a new opening, a replacement or praise.

Set category to "sentence-openings". If you find none, return an empty array.
Do not pad the list.
