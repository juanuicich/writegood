/** A thin client for TypeSafe's Jev evaluation endpoint: one Noul question
 *  per candidate span, batched many-in-one-request per paragraph.
 *
 *  https://api.typesafe.ai/v1/systemone — POST {state, model, questions},
 *  back {answers, usage}. Price: $0.042 per million input tokens; output is
 *  free (docs/index cached under scratchpad/jev/, read 2026-09-23). */
import { key } from "../lib";

const URL = "https://api.typesafe.ai/v1/systemone";
const RATE_PER_M_INPUT = 0.042;
const MODEL = "jev-latest";

export interface NoulQuestion {
  type: "noul";
  instructions: unknown;
  criteria?: { true?: string; false?: string };
}

export interface JevUsage {
  inputTokens: number;
  outputTokens: number;
  cost: number;
}

let cached: string | null = null;
function authKey(): string {
  if (cached === null) cached = key("TYPESAFE_API_KEY");
  return cached;
}

/** Running total across the whole process, so a caller can enforce a spend
 *  ceiling without threading a counter through every call site. */
export let totalCost = 0;
export let totalCalls = 0;

export async function askJev(
  state: string,
  questions: Record<string, NoulQuestion>,
  ceilingSecs = 60,
): Promise<{ answers: Record<string, { noul: number }>; usage: JevUsage; secs: number }> {
  const body = { state, model: MODEL, questions };
  const t0 = performance.now();
  let lastErr: unknown = new Error("no attempt made");
  for (let attempt = 0; attempt < 4; attempt++) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), ceilingSecs * 1000);
    try {
      const r = await fetch(URL, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${authKey()}` },
        body: JSON.stringify(body),
        signal: ctl.signal,
      });
      const text = await r.text();
      if (r.status === 429 || r.status === 529) {
        lastErr = new Error(`${r.status} ${text.slice(0, 200)}`);
        clearTimeout(timer);
        await new Promise((res) => setTimeout(res, 500 * 2 ** attempt));
        continue;
      }
      let j: any;
      try {
        j = JSON.parse(text);
      } catch {
        throw new Error(`${r.status} ${text.slice(0, 200)}`);
      }
      if (!r.ok || j.error) throw new Error(`${r.status} ${JSON.stringify(j.error ?? j).slice(0, 300)}`);
      const u = j.usage ?? {};
      const inputTokens = u.input_tokens ?? 0;
      const outputTokens = u.output_tokens ?? 0;
      const cost = (inputTokens * RATE_PER_M_INPUT) / 1e6;
      totalCost += cost;
      totalCalls += 1;
      return { answers: j.answers ?? {}, usage: { inputTokens, outputTokens, cost }, secs: (performance.now() - t0) / 1000 };
    } catch (e) {
      if (ctl.signal.aborted) {
        lastErr = new Error(`did not answer within ${ceilingSecs}s`);
        clearTimeout(timer);
        break;
      }
      lastErr = e;
      clearTimeout(timer);
      break;
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

/** Throws once cumulative spend for this process crosses the ceiling. Call
 *  before each batch so the budget stops the run, not just reports it. */
export function checkBudget(ceiling: number) {
  if (totalCost > ceiling) throw new Error(`Jev spend $${totalCost.toFixed(4)} passed the $${ceiling} budget; stopping`);
}
