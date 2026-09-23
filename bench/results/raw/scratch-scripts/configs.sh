#!/bin/bash
# Run one named configuration over the four evaluation drafts.
cd "$(dirname "$0")"
D=eval/draft-essay.md,eval/draft-memo.md,eval/draft-story.md,$HOME/.writegood/documents/on-writing.md
name=$1; shift
bun bench2.ts "$@" --drafts "$D" --out "runs/$name.json" > "runs/$name.txt" 2>&1
bun score.ts "runs/$name.json" >> "runs/$name.txt"
cat "runs/$name.txt"
