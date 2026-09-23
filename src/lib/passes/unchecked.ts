/** Which paragraphs are not checked (SPEC §12.4).
 *
 *  A paragraph is not checked when at least one enabled paragraph-scope pass
 *  has no saved answer for the paragraph as it is now. The keys are the
 *  runner's own (SPEC §8.3), from `passKeys`, so a paragraph is checked
 *  exactly when the next run would not ask about it. */
import { store, type Pass } from "../ipc";
import { app } from "../state.svelte";
import { resolve, providerFor, type Resolved } from "../providers";
import { preamble } from "./schema";
import { paragraphs } from "./parse";
import { passKeys, withPass } from "./run";

/** One pass: the key of each paragraph, in order, and the keys it has
 *  saved answers for. */
export interface PassCheck {
  keys: string[];
  saved: Set<string>;
}

/** The indices of the paragraphs that at least one pass has no answer for.
 *  Null when no pass has any saved answer, which means no pass has run on
 *  this document yet. An empty list when there is no pass to check. */
export function unchecked(checks: PassCheck[]): number[] | null {
  if (checks.length === 0) return [];
  if (checks.every((c) => c.saved.size === 0)) return null;
  const count = Math.max(...checks.map((c) => c.keys.length));
  const found: number[] = [];
  for (let i = 0; i < count; i++) {
    if (checks.some((c) => !c.saved.has(c.keys[i]!))) found.push(i);
  }
  return found;
}

/** The paragraphs of `draft` that are not checked, by their index in
 *  `paragraphs(draft)`. `override` is the session's provider, as the runner
 *  gets it. A pass whose provider does not resolve is left out, because it
 *  cannot have answers. */
export async function uncheckedParagraphs(
  passes: Pass[],
  override: string | null,
  draft: string,
): Promise<number[] | null> {
  const config = app.config;
  const doc = app.doc;
  if (!config || !doc) return [];
  const system = preamble(config.rules);
  const paras = paragraphs(draft);
  const checks = await Promise.all(
    passes
      .filter((p) => p.enabled && p.scope === "paragraph")
      .map(async (pass): Promise<PassCheck | null> => {
        const name = providerFor(config, pass.provider, override);
        let resolved: Resolved;
        try {
          resolved = withPass(resolve(config, name), pass);
        } catch {
          return null;
        }
        const [keys, saved] = await Promise.all([
          passKeys(pass, name, resolved, system, paras, draft),
          store.reviewedKeys(doc.id, pass.slug),
        ]);
        return { keys, saved: new Set(saved) };
      }),
  );
  return unchecked(checks.filter((c): c is PassCheck => c !== null));
}
