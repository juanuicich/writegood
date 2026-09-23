# writegood

You write a draft here. You run editing passes over it. Each pass is a prompt you wrote. The app shows what the model found, next to the words it found it in. You do the rewriting.

Press Esc to go back to your draft.

## The two rules

The app never puts a word from the model into your document. There is no accept button. A note that quotes wording your draft does not contain is hidden until you press `r`.

The app never shows praise. A pass that finds nothing says "no findings".

## Writing

Type. The app saves as you go. `⌘S` saves now.

`⌘N` starts an untitled draft. The first `⌘S` asks where to save it. Until then the app keeps it in `~/.writegood/untitled`, so nothing is lost.

`⌘O` opens a Markdown or text file from any folder. `⌘⇧S` saves the draft to a new file, and its history and findings go with it. `⌘⌥S` saves and flags a major revision, and asks what changed.

*open recent* in the command bar lists the files you opened before. So does File > Open Recent.

## Find and replace

`⌘F` opens the find bar. `⌥⌘F` opens it with a field for the replacement. The search ignores case unless you type a capital letter.

- `Enter` or `⌘G`: next match
- `⇧Enter` or `⌘⇧G`: previous match
- `Enter` in the replace field: replace this match and go to the next
- `⌥Enter` in the replace field: replace every match
- Esc: close the bar and go back to the text

`⌘Z` undoes a replacement.

## Running passes

`⌘R` or `⌘⏎` runs every enabled pass. `⌘⇧R` runs one pass, and asks which.

Findings appear as underlines in the text and as notes in the margin. They appear as each reply arrives, before the run ends. A heavier underline is a more serious finding. Click an underline to light its notes.

The app saves every answer. A rerun asks only about the paragraphs you changed and the paragraph after each. Findings on unchanged paragraphs stay as they are, and a finding you dismissed stays dismissed. The findings on a changed paragraph are replaced. A pass that fails keeps its old findings.

*run all passes afresh*, in the command bar, asks about every paragraph again.

A long draft is sent in parts of a few thousand words, each with a few paragraphs of context either side. This keeps a chapter fast and cheap to review.

`⌃⌘S` hides or shows the margin. The underlines stay. Review mode and a new finding show the margin again.

`⌥↓` and `⌥↑` step to the next and previous finding without leaving the text.

## Review mode

Esc leaves the text and enters review mode. The draft dims and single keys act on the findings.

If the find bar is open, Esc closes it first. If you selected text, Esc clears the selection first. Press Esc again to enter review mode.

In review mode, a grey dot in the left margin marks each paragraph that is not checked. The next run asks about these paragraphs: the ones you edited since the last run, and the paragraph after each. Before the first run there are no dots.

- `n` or `j`: next finding
- `p` or `k`: previous finding
- `x`: mark the finding addressed
- `d`: dismiss the finding
- `r`: reveal a hidden span
- `i`, `Enter` or Esc: back to writing

## Revisions

`⌘Y` opens the revisions. `j` and `k` move between them. The diff shows what changed since the selected revision. `Enter` puts that revision back. Esc closes.

## The duel

`⌘D` copies the current paragraph and gives you a box to rewrite it. `⌘R` or `⌘⏎` asks a judge which version is better. The judge does not know which version is new. Esc closes.

## The command bar

`⌘K` opens the command bar. Every command is there: open, new, run, provider, theme, clear findings, and the rest. Type to filter. `Enter` runs the selected command.

## Text size and theme

`⌘+` and `⌘-` change the text size. `⌘0` returns to the base size. The theme commands are in the command bar and in the View menu. The app saves each change to `config.toml`.

## Files

Everything lives in `~/.writegood`.

- `config.toml`: providers, rules and appearance
- `documents/`: where the open and save dialogs start
- `untitled/`: drafts you have not saved yet
- `passes/`: your prompts, one Markdown file each
- `writegood.db`: revisions, findings and duels

A pass is a Markdown file with TOML frontmatter. Edit the files, then run *reload passes and config* from the command bar.

`⌘?` opens this page.
