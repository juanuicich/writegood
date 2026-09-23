/** A thin client for TypeSafe's Jev endpoint, supporting Noul and Choice
 *  questions. A self-contained copy for bench/scripts/jev-nolist/ rather
 *  than importing bench/scripts/jev/jev-client.ts, so the earlier,
 *  list-based benchmark code is never touched by this task.
 *
 *  https://api.typesafe.ai/v1/systemone — POST {state, model, questions},
 *  back {answers, usage}. Price: $0.042 per million input tokens; output is
 *  free (docs cached under scratchpad/jev/, read 2026-09-23). */
import { key } from "../lib";

const URL = "https://api.typesafe.ai/v1/systemone";
const RATE_PER_M_INPUT = 0.042;
const MODEL = "jev-latest";

export interface NoulQuestion {
  type: "noul";
  instructions: unknown;
  criteria?: { true?: string; false?: string };
}

export interface ChoiceQuestion {
  type: "choice";
  instructions: unknown;
  criteria: Record<string, unknown>;
}

export type Question = NoulQuestion | ChoiceQuestion;

export interface NoulAnswer {
  type: "noul";
  noul: number;
}

export interface ChoiceAnswer {
  type: "choice";
  choice: string;
  probabilities: Record<string, number>;
  confidence: number;
}

export type Answer = NoulAnswer | ChoiceAnswer;

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

export let totalCost = 0;
export let totalCalls = 0;

export async function askJev(
  state: unknown,
  questions: Record<string, Question>,
  ceilingSecs = 60,
): Promise<{ answers: Record<string, Answer>; usage: JevUsage; secs: number }> {
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

export function checkBudget(ceiling: number) {
  if (totalCost > ceiling) throw new Error(`Jev spend $${totalCost.toFixed(4)} passed the $${ceiling} budget; stopping`);
}
