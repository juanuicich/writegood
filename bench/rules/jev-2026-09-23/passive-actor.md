+++
name = "Missing actor (Jev)"
category = "passive-actor"
scope = "paragraph"
method = "jev"
+++

Checks the same problem as `bench/rules/2026-09-23-rewrite/02-passive-actor.md`:
a clause that hides who acted when the reader needs to know.

Documentation only; the source of record is `bench/scripts/jev/rules.ts`
(the Jev question) and `bench/scripts/jev/candidates.ts`
(`findPassiveActorCandidates`).

## Candidates (code)

For each sentence, match a form of "be" (is, are, was, were, be, been,
being) followed by a past participle (a generic -ed or -en word, plus a list
of irregular participles), or the impersonal pattern "it {is/was/has
been/had been} decided/recommended/believed/... that". Two exclusions run in
code, because they are exact, not a judgment: skip a match followed by "by"
within the next few words (the actor is stated), and skip a small list of
participles that read as adjectives, not actions (closed, located, based,
situated, and the like) — the same "adjectives that look passive" exclusion
the LLM rule lists.

## Jev question

```json
{
  "type": "noul",
  "instructions": {
    "sentence": "<the sentence containing the candidate>",
    "candidate": "<the candidate quote>",
    "question": "In `sentence`, is `candidate` a passive or impersonal verb whose actor is missing, where neither the sentence nor its surrounding context names the actor or makes it obvious, and the reader needs to know who acted because the action is a decision, an error, a cost, or a claim someone is responsible for?"
  },
  "criteria": {
    "true": "The clause hides who is responsible for a decision, an error, a cost, or a claim, and the text never says.",
    "false": "The actor is named, including in a 'by' phrase; or the actor is obvious from context; or the actor is unknown or irrelevant, such as a historical fact or a date; or this is a methods passive where the author is plainly the actor; or the phrase is really an adjective, such as 'is closed', 'is based on', 'is located in'."
  }
}
```

`sentence` alone is the state Jev sees for this judgment — the paragraph
sent as the API's `state` gives Jev the surrounding context the question
refers to ("its surrounding context") without another hop.

## Keep and severity

Kept when the Noul probability is at least 0.4, lower than the other two
passes. A probe against `draft-essay.md` found Jev scoring a real,
gold-listed miss ("The combination was forgotten", the rule's own
low-severity case) at 0.43, almost the same as a genuine decoy under the
rule's own "actor unknown or irrelevant" exclusion ("My bike was stolen",
0.42). 0.5 lost the real miss; 0.4 is the compromise, and it does not fully
separate the two. See "what did not work" in `bench/results/2026-09-23-jev.md`.

Severity from probability:

- 0.85–1.0: high
- 0.65–0.85: medium
- 0.4–0.65: low

## Note

Fixed text: `Passive or impersonal construction with no actor named
nearby.`
