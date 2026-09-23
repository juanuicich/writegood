#!/bin/bash
# The fast pipeline end to end: generate with thinking off, filter in code,
# verify with three voters. Usage: fast.sh NAME [bench2 flags...]
cd "$(dirname "$0")"
D=${DRAFTS:-eval/draft-essay.md,eval/draft-memo.md,eval/draft-story.md,$HOME/.writegood/documents/on-writing.md}
name=$1; shift
bun bench2.ts --thinking off "$@" --drafts "$D" --out "runs/$name.gen.json" > "runs/$name.txt" 2>&1
bun filter.ts "runs/$name.gen.json" "runs/$name.f.json" --in-paragraph --dedupe >> "runs/$name.txt"
bun verify.ts "runs/$name.f.json" "runs/$name.json" --prompt balanced --votes 3 --need 2 >> "runs/$name.txt" 2>&1
bun score.ts "runs/$name.json" --by-pass >> "runs/$name.txt"
cat "runs/$name.txt"
