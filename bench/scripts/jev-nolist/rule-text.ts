/** Reads a pass's rule prompt verbatim from bench/rules/2026-09-23-rewrite/
 *  and strips only the TOML frontmatter — the same split loadRules() in
 *  bench/scripts/lib.ts does for the LLM passes.
 *
 *  This is the whole point of the no-list approach: the rule text a human
 *  wrote for the LLM pass is also the whole definition Jev reads. Nothing
 *  here encodes which words, suffixes or participles count; it only removes
 *  the "+++ name = ... +++" header so what is left is prose. */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { RULES } from "../lib";

const RULE_SET = "2026-09-23-rewrite";

const FILES: Record<string, string> = {
  nominalization: "01-nominalization.md",
  "passive-actor": "02-passive-actor.md",
  "sentence-openings": "03-sentence-openings.md",
  "filler-words": "04-filler-words.md",
  "repeated-phrasing": "05-repeated-phrasing.md",
  "paragraph-order": "06-paragraph-order.md",
  "topic-flow": "07-topic-flow.md",
  "unearned-metaphor": "08-unearned-metaphor.md",
  length: "09-length.md",
};

export function ruleText(slug: string): string {
  const file = FILES[slug];
  if (!file) throw new Error(`no rule file known for pass "${slug}"`);
  const text = readFileSync(join(RULES, RULE_SET, file), "utf8");
  const parts = text.split(/^\+\+\+$/m);
  return parts.slice(2).join("+++").trim();
}

export const PASS_SLUGS = Object.keys(FILES);
