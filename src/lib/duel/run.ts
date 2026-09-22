/** Running a duel (SPEC 11).
 *
 *  You rewrite a paragraph. A model that has never seen the editing session
 *  says which version reads better, without being told which one you wrote
 *  second. The shuffle and the prompt live in `judge.ts`; this file is the part
 *  that talks to a provider and writes the result down. */
import { cli, llm, store, type Config, type Duel } from "../ipc";
import { resolve, ProviderError, type Resolved } from "../providers";
import { judgePrompt, originalWon, parseVerdict, shuffle, type Verdict } from "./judge";
import { total, UNREPORTED } from "../usage";

export interface DuelOutcome {
  duel: Duel;
  verdict: Verdict;
  /** null for a tie. */
  originalWon: boolean | null;
  /** Set when the judge shares a vendor with the passes, which devalues it. */
  warning?: string;
}

/** Which provider judges. Falls back to the default, which is worth less. */
export function judgeName(config: Config): string {
  return config.judgeProvider ?? config.defaultProvider;
}

function blindnessWarning(config: Config, judge: Resolved): string | undefined {
  if (!config.rules.blindJudge) return undefined;
  if (config.judgeProvider && config.judgeProvider !== config.defaultProvider) return undefined;

  const passes = config.providers[config.defaultProvider];
  if (passes && passes.kind !== judge.provider.kind) return undefined;

  return `the judge and the passes are both ${judge.vendor} — set judge_provider in config.toml`;
}

export async function runDuel(
  config: Config,
  docId: number,
  original: string,
  rewrite: string,
  findingId: number | null = null,
): Promise<DuelOutcome> {
  if (rewrite.trim().length === 0) throw new Error("nothing to compare");
  if (rewrite.trim() === original.trim()) throw new Error("the two versions are identical");

  const name = judgeName(config);
  let judge: Resolved;
  try {
    judge = resolve(config, name);
  } catch (e) {
    throw new Error(e instanceof ProviderError ? e.message : String(e));
  }

  const { aText, bText, aIsOriginal } = shuffle(original, rewrite);
  const { system, prompt } = judgePrompt(aText, bText);

  // A fresh call with no editing history. Nothing here tells the model that
  // one of these passages is a revision of the other.
  const reply =
    judge.provider.kind === "cli"
      ? { text: await cli.run(judge.provider, `${system}\n\n${prompt}`), ...UNREPORTED }
      : await llm.chat(name, judge.provider, system, prompt);
  const text = reply.text;

  const verdict = parseVerdict(text, name);

  const duel = await store.recordDuel({
    docId,
    findingId,
    aText,
    bText,
    aIsOriginal,
    judgeProvider: name,
    judgeModel: judge.provider.model ?? null,
    verdict: verdict.verdict,
    reason: verdict.reason,
    usage: total([reply]),
  });

  return {
    duel,
    verdict,
    originalWon: originalWon(verdict.verdict, aIsOriginal),
    warning: blindnessWarning(config, judge),
  };
}

/** One line for the status bar. */
export function describe(outcome: DuelOutcome): string {
  const who =
    outcome.originalWon === null
      ? "a tie"
      : outcome.originalWon
        ? "your first version won"
        : "your rewrite won";
  return outcome.warning ? `${who} · ${outcome.warning}` : who;
}
