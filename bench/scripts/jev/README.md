# Jev with word lists: do not ship

This folder holds the first Jev benchmark, from 23 September 2026. Its
results are in `bench/results/2026-09-23-jev.md`.

This method must not ship. `candidates.ts` and `rules.ts` decide what to flag
with hand-written English word lists, suffix patterns and regexes. That breaks
the rule that a pass's rule text is its whole definition. The lists also work
only in English.

The code stays here as a record of that run. Do not build on it.

The method that follows the rule is in `bench/scripts/jev-nolist/`. There,
code only segments text with `Intl.Segmenter`, lists spans, locates quotes and
removes duplicates. Jev reads the pass's rule text and decides what is flagged.
Its results are in `bench/results/2026-09-23-jev-nolist.md` and
`bench/results/2026-09-23-followup.md`.
