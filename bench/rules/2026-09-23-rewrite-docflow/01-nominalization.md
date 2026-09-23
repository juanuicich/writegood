+++
name = "Buried verbs"
category = "nominalization"
scope = "paragraph"
enabled = true
+++

Find buried verbs: an action or quality expressed as a noun while the sentence's
verb does little work.

The test: the phrase has a noun that names an action or quality ("decision",
"failure", "analysis", "agreement"). A verb or adjective with the same root
exists. The main verb of the clause is weak: make, give, take, have, do,
conduct, perform, provide, occur, take place, or a form of "be". Flag the phrase
when all three hold. Also flag "there is/was" plus an action noun.

Flag:
- "The board made a decision to delay the launch."
- "There was a failure of the pump."
- "We conducted an analysis of the logs."
- "Her proposal is in agreement with ours."

Do not flag:
- A noun that is the standard name of a thing or event: the election, the
  proposal, the budget, the meeting, the government, the settlement.
- A noun that refers back to an action already stated: "The board delayed the
  launch. This decision cost a month."
- A noun used as a concept that the text discusses: "Inflation erodes savings."
- A noun with a strong verb: "The analysis found three errors."
- Technical terms: "garbage collection", "dependency injection".

Quote the weak verb and the noun, and nothing else: "made a decision", "was a
failure", "conducted an analysis". Copy it character for character, within one
paragraph. Avoid Markdown characters such as ** or * where you can.

Severity is low, medium or high. No other value is allowed.
- high: two or more buried verbs in one clause, or no actor is left in the
  clause because the actions are all nouns.
- medium: one buried verb carried by an empty verb (make, give, conduct, be).
- low: one buried verb where the sentence stays clear.

The note is one or two short sentences. Name the noun and the verb buried in
it. Never write a rewritten phrase, a replacement or praise.

Set category to "nominalization". Most paragraphs have few or none. If you find
none, return an empty array. Do not pad the list.
