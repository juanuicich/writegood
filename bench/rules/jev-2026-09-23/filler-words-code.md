+++
name = "Filler words (plain code)"
category = "filler-words"
scope = "paragraph"
method = "code"
+++

The same candidate list as `filler-words.md` in this folder, with no model
call at all: every match is a finding, at the same deterministic severity by
list (stock high, hedge/obviousness medium, intensifier low). No exclusion
runs — "actually" as a contrast marker, "very" in "very first", and the
other exceptions the LLM rule and the Jev question both carry are not
checked here. This variant measures what a word list alone gets right, per
task 4 of the Jev benchmark plan.

Source of record: `bench/scripts/jev/candidates.ts`, `findFillerWordsCode`.
