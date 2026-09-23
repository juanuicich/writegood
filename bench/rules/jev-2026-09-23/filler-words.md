+++
name = "Filler words (Jev)"
category = "filler-words"
scope = "paragraph"
method = "jev"
+++

Checks the same problem as `bench/rules/2026-09-23-rewrite/04-filler-words.md`:
words and stock phrases that add emphasis or hedging but no meaning.

Documentation only; the source of record is `bench/scripts/jev/rules.ts`
(the Jev question) and `bench/scripts/jev/candidates.ts`
(`findFillerCandidates`).

## Candidates (code)

A fixed word and phrase list, matched case-insensitively, in three groups
that also set severity (see below): intensifiers (very, really, quite,
truly, extremely, incredibly, totally); obviousness and hedge words
(clearly, obviously, of course, unfortunately, interestingly, importantly,
basically, actually, essentially, sort of, kind of); and stock phrases (it
should be noted that, it is important to remember that, it is worth
mentioning that, needless to say, the fact that). This is the same list the
LLM rule gives as "typical filler". "Just" is left out, as the LLM rule
does, because its exceptions (meaning "only" or "a moment ago") are common
enough that a bare word match would be wrong too often; a filler use of
"just" needs the model's judgment, and this candidate list does not attempt
it.

## Jev question

```json
{
  "type": "noul",
  "instructions": {
    "sentence": "<the sentence containing the candidate>",
    "candidate": "<the candidate quote>",
    "question": "If `candidate` is removed from `sentence`, does the sentence still state the same fact, with the same scope and the same certainty? Answer yes if removing it changes nothing but emphasis, a hedge, or a claim of obviousness."
  },
  "criteria": {
    "true": "Removing the word or phrase leaves the same fact, the same scope, and the same certainty; it was filler.",
    "false": "Removing it changes the meaning, such as 'very first' or 'not quite finished'; or it states real uncertainty, such as 'probably'; or it is 'actually' marking a contrast with what the reader expects; or it is inside a quotation, dialogue, or a title."
  }
}
```

## Keep and severity

Kept when the Noul probability is at least 0.5. Unlike the other two Jev
passes, severity here is deterministic from which list the candidate
matched, not from probability — the LLM rule already gives each list a
severity, so there is nothing for Jev to add:

- stock phrase: high
- obviousness/hedge word: medium
- intensifier: low

## Note

Fixed text per category: `Stock phrase that delays the content and adds
nothing.` / `Empty hedge or claim of obviousness that adds no fact.` /
`Intensifier that adds emphasis only.`
