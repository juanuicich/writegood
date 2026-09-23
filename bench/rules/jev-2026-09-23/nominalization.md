+++
name = "Buried verbs (Jev)"
category = "nominalization"
scope = "paragraph"
method = "jev"
+++

Checks the same problem as `bench/rules/2026-09-23-rewrite/01-nominalization.md`:
an action or quality expressed as a noun while the sentence's verb does little
work.

This file is documentation, not code the benchmark loads. The source of
record is `bench/scripts/jev/rules.ts` (the Jev question) and
`bench/scripts/jev/candidates.ts` (`findNominalizationCandidates`). Keep them
in sync by hand.

## Candidates (code)

For each sentence in the paragraph, find every weak verb phrase (a form of
"be"; make, give, take, have, do; conduct, carry out, perform, provide,
occur, come to, take place) and every noun that looks like a nominalization:
a word of four or more letters ending in -tion, -sion, -ment, -ance, -ence,
-ancy, -ency, -ure or -ysis, plus a short list of common zero-derivation
nouns the suffix test misses (review, undertaking, attempt, effort, answer,
change, and similar). Pair a noun with the nearest weak verb within eight
words in the same sentence. The candidate quote spans from the earlier of
the two matches to the later.

This is deliberately broad. A noun that is really a standard thing's name
("election", "proposal") also matches the suffix test; Jev is the filter.

## Jev question

One Noul question per candidate. `sentence` and `candidate` are state Jev
reads directly, not indirection.

```json
{
  "type": "noul",
  "instructions": {
    "sentence": "<the sentence containing the candidate>",
    "candidate": "<the candidate quote>",
    "question": "In `sentence`, does `candidate` show a buried verb: an action or a quality named as a noun (such as decision, failure, analysis, agreement) while the clause's real verb is weak (a form of be, or make, give, take, have, do, conduct, perform, provide, occur, or take place)? Answer yes only when the noun could instead be the sentence's main verb and the sentence would state the same action more directly."
  },
  "criteria": {
    "true": "The clause's real action is hidden in the noun, carried by a weak verb; rewriting the noun as the main verb keeps the same meaning.",
    "false": "The verb is already a strong, specific action; or the noun is the standard name of a thing, an event, or a concept the text discusses, not a hidden action; or the noun just refers back to an action already stated in an earlier sentence."
  }
}
```

The `false` branch carries the same "do not flag" list as the LLM rule: a
standard thing's name, a noun that refers back to an action already stated,
a concept the text discusses, and a noun paired with a strong verb.

## Keep and severity

Kept when the Noul probability is at least 0.5. Severity comes from the
probability, since the LLM rule's own bands (two buried verbs, or an empty
verb) need structure a single yes/no question does not carry:

- 0.85–1.0: high
- 0.65–0.85: medium
- 0.5–0.65: low

## Note

Fixed text, not model wording: `Weak verb "<verb>" carries the buried noun
"<noun>."`, where `<verb>` and `<noun>` are the code's own matched text.
