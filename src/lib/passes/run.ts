/** Running editing passes over a draft (SPEC 8.3).
 *
 *  A pass is one prompt, sent once for the draft or once per paragraph. Every
 *  call of every pass shares one bound on how many run at once.
 *
 *  A pass with thinking off runs in two stages: its calls give candidates,
 *  code filters drop the impossible ones, and three verifiers vote on the
 *  rest. The pass then stores what survives, once. A pass with thinking on
 *  stores each call's findings as the call returns. Either way the first
 *  write of a run replaces the findings of the pass's earlier runs. */
import { cli, llm, log, store, type NewFinding, type Pass } from "../ipc";
import { app } from "../state.svelte";
import { resolve, providerFor, ProviderError, type Resolved } from "../providers";
import { preamble } from "./schema";
import { buildPrompt, paragraphs, readFindings, unfit } from "./parse";
import { deadline } from "./deadline";
import { limiter } from "./limit";
import { inParagraph, Repeats } from "./filter";
import { buildVerifyPrompt, parseVerdicts, tally, VERIFY_SYSTEM, VOTES } from "./verify";
import { NONE, total, UNREPORTED, type Call } from "../usage";

/** Model calls in flight at once, across every pass in a run. DeepSeek allows
 *  thousands per account; the bound keeps a long draft from opening a few
 *  hundred connections at the same moment. With thinking off a call takes one
 *  or two seconds, so 32 at once finish a 500-word draft in about five. */
const MAX_CALLS = 32;

/** Both backends end at the same place: a block of text that should contain a
 *  JSON array of findings.
 *
 *  Both also run in Rust — `llm_chat` for the network, `cli_run` for a
 *  subprocess — each with its own timeout. The deadline here is a second line
 *  of defence with more slack, so Rust's clearer message normally wins.
 *
 *  The call's usage goes into `calls` before the reply is parsed. A reply
 *  that will not parse was still paid for. */
async function ask(
  resolved: Resolved,
  system: string,
  prompt: string,
  calls: Call[],
): Promise<string> {
  const seconds = Math.max(resolved.provider.timeoutSecs, 30);
  void log.write(
    "info",
    `asking ${resolved.name} (${resolved.provider.model ?? resolved.provider.kind}), ` +
      `${prompt.length} characters, ceiling ${seconds}s`,
  );

  const call =
    resolved.provider.kind === "cli"
      ? cli.run(resolved.provider, `${system}\n\n${prompt}`).then((text) => ({ text, ...UNREPORTED }))
      : llm.chat(resolved.name, resolved.provider, system, prompt);

  const { text, tokens, costUsd } = await deadline(call, (seconds + 30) * 1000, resolved.name);
  calls.push({ tokens, costUsd });
  void log.write("info", `${resolved.name} answered with ${text.length} characters`);
  return text;
}

export interface RunReport {
  pass: string;
  findings: number;
  error?: string;
}

/**
 * Run the given passes against the open document. Saves first, so every run
 * records the revision it examined.
 */
export async function runPasses(
  passes: Pass[],
  options: { override?: string | null } = {},
): Promise<RunReport[]> {
  const config = app.config;
  if (!config) throw new Error("config not loaded");
  if (!app.doc || !app.editor) throw new Error("no document open");

  await app.save(false);
  const docId = app.doc.id;
  const draft = app.plainText();
  if (draft.trim().length === 0) throw new Error("the draft is empty");

  const revisions = await store.revisions(docId);
  const revisionId = revisions[0]?.id;
  if (revisionId === undefined) throw new Error("no revision to run against");

  const system = preamble(config.rules);

  // What the status bar reports while this runs. "working" said nothing; the
  // names of the passes with a call in flight say what the app is waiting for.
  const inFlight = new Map<string, number>();
  let done = 0;
  const report = () => {
    app.progress = { done, total: passes.length, active: [...inFlight.keys()] };
  };
  const asking = (pass: string, delta: 1 | -1) => {
    const n = (inFlight.get(pass) ?? 0) + delta;
    if (n > 0) inFlight.set(pass, n);
    else inFlight.delete(pass);
    report();
  };
  const limit = limiter(MAX_CALLS);

  const runOne = async (pass: Pass): Promise<RunReport> => {
    const name = providerFor(config, pass.provider, options.override);
    let resolved: Resolved;
    try {
      resolved = withPass(resolve(config, name), pass);
    } catch (e) {
      const message = e instanceof ProviderError ? e.message : String(e);
      const run = await store.startRun(docId, revisionId, pass.slug, pass.name, name, null);
      await store.finishRun(run.id, "error", message, NONE);
      return { pass: pass.name, findings: 0, error: message };
    }

    const run = await store.startRun(
      docId,
      revisionId,
      pass.slug,
      pass.name,
      name,
      resolved.provider.model ?? null,
    );

    const collected: NewFinding[] = [];
    const calls: Call[] = [];
    let failure: string | null = null;
    const verified = verifies(resolved);
    const priority = verified ? 1 : 0;
    const candidates: NewFinding[] = [];
    const repeats = new Repeats(draft);
    // Items the schema rejected, over the whole pass. One bad item in one
    // reply is dropped; a pass where every item was bad has failed.
    let fit = 0;
    let rejected = 0;
    let why: string | null = null;

    const save = async (found: NewFinding[]) => {
      await store.addFindings(run.id, docId, found);
      collected.push(...found);
      if (found.length > 0) app.showMargin();
      await app.loadFindings();
    };

    // One call per paragraph, all queued at once. The limit decides how many
    // run. A verified pass gathers candidates; any other stores as it goes.
    const call = async (chunk: string | null) => {
      try {
        const text = await limit(async () => {
          // After a failure the pass asks nothing more. Calls already in
          // flight finish, and what they find is kept.
          if (failure !== null) return null;
          asking(pass.name, 1);
          try {
            return await ask(resolved, system, buildPrompt(pass, draft, chunk), calls);
          } finally {
            asking(pass.name, -1);
          }
        }, priority);
        if (text === null) return;
        const read = readFindings(text, resolved.name);
        const found = read.found;
        fit += found.length;
        if (read.rejected > 0) {
          rejected += read.rejected;
          why ??= read.why;
          void log.write("error", `${pass.name}: dropped ${read.rejected} finding(s): ${read.why}`);
        }
        if (verified) {
          candidates.push(...repeats.take(chunk === null ? found : inParagraph(found, chunk)));
        } else if (found.length > 0) {
          await save(found);
        }
      } catch (e) {
        failure ??= e instanceof Error ? e.message : String(e);
      }
    };

    const chunks = pass.scope === "paragraph" ? paragraphs(draft) : [null];
    void log.write(
      "info",
      `${pass.name}: ${chunks.length} call(s), ${pass.scope} scope, thinking ${resolved.provider.thinking ?? "default"}`,
    );
    await Promise.all(chunks.map(call));
    if (fit === 0 && rejected > 0) failure ??= unfit(resolved.name, rejected, why);

    if (verified && candidates.length > 0) {
      try {
        const kept = await verify(pass, resolved, draft, candidates, calls, limit, asking);
        void log.write("info", `${pass.name}: kept ${kept.length} of ${candidates.length} candidate(s)`);
        // After a failure, store only what survived; an empty list would
        // replace the pass's earlier findings with nothing.
        if (failure === null || kept.length > 0) await save(kept);
      } catch (e) {
        failure ??= e instanceof Error ? e.message : String(e);
      }
    }

    if (failure !== null) {
      // What arrived before the failure is already stored. Keep what was
      // spent on it too.
      await store.finishRun(run.id, "error", failure, total(calls));
      void log.write("error", `${pass.name}: ${failure}`);
      return { pass: pass.name, findings: collected.length, error: failure };
    }
    // A pass that found nothing still replaces what it found before.
    if (collected.length === 0) {
      await store.addFindings(run.id, docId, []);
      await app.loadFindings();
    }
    await store.finishRun(run.id, "done", null, total(calls));
    void log.write("info", `${pass.name}: done, ${collected.length} finding(s)`);
    return { pass: pass.name, findings: collected.length };
  };

  report();
  // Passes that think go first: their calls are the slowest (SPEC §8.3). An
  // unknown provider counts as thinking; the pass reports it when it runs.
  const thinks = (p: Pass) =>
    (p.thinking ?? config.providers[providerFor(config, p.provider, options.override)]?.thinking ?? null) !== "off";
  const ordered = [...passes].sort((a, b) => Number(!thinks(a)) - Number(!thinks(b)));
  const results = new Map<Pass, RunReport>();
  await Promise.all(
    ordered.map(async (pass) => {
      try {
        results.set(pass, await runOne(pass));
      } catch (e) {
        results.set(pass, { pass: pass.name, findings: 0, error: String(e) });
      } finally {
        done += 1;
        report();
      }
    }),
  );
  await app.loadUsage();
  return passes.map((p) => results.get(p)!);
}

/** The provider as this pass uses it: the pass's thinking and ceiling win
 *  over the provider's (SPEC §8.1). */
function withPass(resolved: Resolved, pass: Pass): Resolved {
  const provider = {
    ...resolved.provider,
    thinking: pass.thinking ?? resolved.provider.thinking ?? null,
    timeoutSecs: pass.timeoutSecs ?? resolved.provider.timeoutSecs,
  };
  return { ...resolved, provider };
}

/** A pass runs in two stages when its model does not think (SPEC §8.3). */
function verifies(resolved: Resolved): boolean {
  return resolved.provider.kind !== "cli" && resolved.provider.thinking === "off";
}

/** Three verifiers vote on a pass's candidates; the ones two keep survive.
 *  Their calls count towards the pass's usage. */
async function verify(
  pass: Pass,
  resolved: Resolved,
  draft: string,
  candidates: NewFinding[],
  calls: Call[],
  limit: ReturnType<typeof limiter>,
  asking: (pass: string, delta: 1 | -1) => void,
): Promise<NewFinding[]> {
  const prompt = buildVerifyPrompt(pass.prompt, draft, candidates);
  const votes = await Promise.all(
    Array.from({ length: VOTES }, () =>
      limit(async () => {
        asking(pass.name, 1);
        try {
          return parseVerdicts(await ask(resolved, VERIFY_SYSTEM, prompt, calls), candidates.length);
        } catch (e) {
          void log.write("error", `${pass.name}: a verifier failed: ${e instanceof Error ? e.message : String(e)}`);
          return null;
        } finally {
          asking(pass.name, -1);
        }
      }),
    ),
  );
  const keep = tally(votes, candidates.length);
  return candidates.filter((_, i) => keep[i]);
}

export function summarise(reports: RunReport[]): string {
  const total = reports.reduce((n, r) => n + r.findings, 0);
  const failed = reports.filter((r) => r.error);
  const found = total === 0 ? "no findings" : `${total} finding${total === 1 ? "" : "s"}`;
  if (failed.length === 0) return found;
  return `${found} · ${failed.length} pass${failed.length === 1 ? "" : "es"} failed: ${failed[0].error}`;
}
