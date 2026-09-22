/** Adding up what calls used, and saying it in the status bar (SPEC §9.4).
 *
 *  Rust prices each call. This file only sums them and words the result, and
 *  it never turns a missing number into a zero. */
import type { DocUsage, Reply, Usage } from "./ipc";

/** A call's usage without its text. */
export type Call = Pick<Reply, "tokens" | "costUsd">;

/** A CLI call reports nothing. */
export const UNREPORTED: Call = { tokens: null, costUsd: null };

/** Nothing recorded: what a run that failed before its first call stores. */
export const NONE: Usage = { inputTokens: null, outputTokens: null, costUsd: null };

/** Sum a run's calls. Token counts add up over the calls that reported them.
 *  The cost is kept only when every call that reported tokens was priced: a
 *  run that is part priced reads as unpriced, so the dollar figure is never
 *  quietly short. */
export function total(calls: Call[]): Usage {
  const counted = calls.filter((c) => c.tokens !== null);
  if (counted.length === 0) return NONE;
  const inputTokens = counted.reduce((n, c) => n + c.tokens!.input, 0);
  const outputTokens = counted.reduce((n, c) => n + c.tokens!.output, 0);
  const costUsd = counted.every((c) => c.costUsd !== null)
    ? counted.reduce((n, c) => n + c.costUsd!, 0)
    : null;
  return { inputTokens, outputTokens, costUsd };
}

/** Enough places to show a small cost without rounding it to nothing. */
export function dollars(n: number): string {
  if (n === 0) return "$0";
  if (n < 0.01) return `$${n.toFixed(4)}`;
  if (n < 1) return `$${n.toFixed(3)}`;
  return `$${n.toFixed(2)}`;
}

function tokens(n: number): string {
  return `${n.toLocaleString("en-US")} tokens`;
}

/** The status bar's words for a file's usage, or null when nothing has been
 *  recorded yet. */
export function label(u: DocUsage): string | null {
  const priced = u.pricedCalls > 0;
  const unpriced = u.unpricedTokens > 0;
  if (priced && unpriced) return `${dollars(u.costUsd)} · ${tokens(u.unpricedTokens)} unpriced`;
  if (priced) return dollars(u.costUsd);
  if (unpriced) return tokens(u.unpricedTokens);
  return null;
}
