+++
name = "Sentence openings (plain code)"
category = "sentence-openings"
scope = "paragraph"
method = "code"
+++

Checks the same problem as
`bench/rules/2026-09-23-rewrite/03-sentence-openings.md`: a run of sentences
that open the same way, and a subject buried behind a long introductory
phrase. No model is called; this pass is plain code end to end, per task 4
of the Jev benchmark plan, which named this pass as better done in code than
sent to a model at all.

Source of record: `bench/scripts/jev/candidates.ts`, `findSentenceOpenings`.

## A run

Sentences are grouped by the first two words of each, lowercased and
stripped of trailing punctuation. Comparing two words, not one, is what the
LLM rule asks for: it excludes sentences that "share only a one-word article
or pronoun", and a two-word key already cannot match on "The" or "It"
alone. A run of three or more consecutive sentences with the same key is one
finding, quoting the first sentence's opening words. Severity: three
sentences is medium, four or more is high, matching the LLM rule's bands.

## A late subject

This is the weaker half, and the plan flagged the whole pass as a better fit
for code mainly on the strength of the run check. Finding the true subject
needs a parse the code does not have. The approximation: if a sentence opens
with an intro-clause marker (By, After, When, While, Since, Although,
Because, Given, With, Before, Once, If, As, Despite, During, Following,
Having, Upon, Though, Unless, Until, Whereas, Whenever, Wherever) and has a
comma, the words before that comma stand in for "words before the subject".
Severity bands match the LLM rule: 11–15 words low, 16–25 medium, more than
25 high.

This overcounts when the comma is not the end of the introductory clause —
a sentence whose subject appears early, followed by a later, unrelated
comma, reads as a long intro. See "what did not work" in
`bench/results/2026-09-23-jev.md` for a concrete case from `draft-essay.md`.
A sentence with no comma at all is never flagged, so recall is capped by how
often authors punctuate the clause boundary.
