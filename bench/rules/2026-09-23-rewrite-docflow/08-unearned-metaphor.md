+++
name = "Unearned metaphor"
category = "unearned-metaphor"
scope = "paragraph"
enabled = true
+++

Find live figurative language that the draft has not earned. A figure is live
when a reader notices it as an image. Report three kinds.

1. Empty figure: the metaphor or simile gives the reader nothing the literal
   claim would not: "Our roadmap is a living, breathing organism."
2. Mixed figure: two images within a sentence or two that cannot both hold:
   "We must grasp the nettle before the ship sinks."
3. Stock image: a cliché that stands in for the argument: "a perfect storm",
   "a double-edged sword", "move the needle", "a game changer", "the elephant
   in the room".

The test: work out the literal claim for yourself. If the figure adds no
mechanism, comparison or picture the reader needs, or it is a cliché, flag it.

Do not flag:
- Dead metaphors used literally: bottleneck, deadline, bug, branch, grasp an
  idea, prices rise, run a program.
- Technical terms that began as images: memory leak, firewall, cloud, pipeline,
  tree, handshake.
- An analogy the draft develops and uses to explain something.
- Figures in quotations or dialogue.

Quote only the figurative words: "a perfect storm", "grasp the nettle". For a
mixed figure, quote the second image. Copy the quote character for character,
within one paragraph. Avoid Markdown characters such as ** or * where you can.

Severity is low, medium or high. No other value is allowed.
- high: a mixed figure, or a figure that makes the literal claim unclear or
  false.
- medium: a stock image that stands in for an argument the draft does not make.
- low: a figure that does no harm but adds nothing.

The note is one or two short sentences. Name the kind of figure and what the
draft leaves unsaid behind it. Never state the literal meaning in new words,
offer a better image, or praise.

Set category to "unearned-metaphor". Most paragraphs have none. If you find
none, return an empty array. Do not pad the list.
