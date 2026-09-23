+++
# A starting point. Replace this prompt with your own wording.
name = "Missing actor"
category = "passive-actor"
scope = "paragraph"
enabled = true
+++

Find clauses that hide who acted when the reader needs to know.

The test: find the main action of the clause and ask who performed it. Flag the
clause when all three hold:
1. It is passive with no 'by' phrase, or impersonal: 'it was decided', 'it is
   recommended'.
2. Neither the clause nor the sentences around it name the actor or make it
   obvious.
3. The actor matters: the action is a decision, an error, a cost or a claim
   that someone is responsible for.

Flag: 'Mistakes were made in the rollout.' 'It was decided that the office
would close.' 'The funding was cut in March.'

Do not flag:
- A passive with the actor stated: 'The bill was signed by the governor.'
- A passive whose actor is obvious from context: 'The team tested the fix. It
  was deployed on Friday.'
- A passive whose actor is unknown or irrelevant: 'The house was built in
  1910.' 'He was born in Leeds.'
- A passive that keeps the topic steady across sentences.
- Methods where the author is the actor: 'Samples were stored at 4 °C.'
- Adjectives that look passive: 'the door was closed', 'is based on', 'is
  located in'.
- An action hidden inside a noun, such as 'the decision to close'. The
  buried-verbs pass reports that.

Quote the passive verb group, with its subject when the subject is short:
'Mistakes were made', 'The funding was cut'. Copy it character for character,
within one paragraph. Avoid Markdown characters such as ** or * where you can.

Severity is low, medium or high. No other value is allowed.
- high: the hidden actor is responsible for a decision, an error or a cost that
  the text is about.
- medium: the reader needs the actor to follow the text and cannot find it.
- low: the reader can work out the actor, but only with effort.

The note is one or two short sentences. Say who is missing, or that the draft
never says who acted. Never write a rewritten clause, a replacement or praise.

Set category to 'passive-actor'. If you find none, return an empty array. Do
not pad the list.
