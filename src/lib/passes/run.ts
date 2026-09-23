/** Running editing passes over a draft (SPEC 8.3).
 *
 *  A pass is one prompt, sent once for the draft or once per paragraph. Every
 *  call of every pass shares one bound on how many run at once, and each
 *  provider has its own bound under it. A paragraph
 *  call sends its window of the draft, not the whole draft, and a question
 *  whose answer is saved is not asked again.
 *
 *  A pass with thinking off runs in two stages: its calls give candidates,
 *  code filters drop the impossible ones, and three verifiers vote on the
 *  rest. The pass then stores what survives, once. A pass with thinking on
 *  stores each call's findings as the call returns. Either way the first
 *  write of a run replaces the findings of the pass's earlier runs. */
import { cli, jev, llm, log, store, type NewFinding, type Pass } from "../ipc";
import { app } from "../state.svelte";
import { callLimits, resolve, providerFor, ProviderError, type Resolved } from "../providers";
import { preamble } from "./schema";
import { buildPrompt, paragraphStarts, paragraphs, readFindings, unfit } from "./parse";
import { deadline } from "./deadline";
import type { Limit } from "./limit";
import { inParagraph, Repeats } from "./filter";
import { buildVerifyPrompt, parseVerdicts, tally, VERIFY_SYSTEM, VOTES } from "./verify";
import { windowOf, windows, type Window } from "./windows";
import { documentKey, fingerprint, jevFingerprint, paragraphKey } from "./keys";
import {
  cannotRun,
  jevSettings,
  METHOD_FINGERPRINT,
  paragraphFindings,
  Unreadable,
  type Ask,
  type JevSettings,
} from "./jev";
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
  /** New findings stored by this run. */
  findings: number;
  /** Answers taken from earlier runs instead of asked again (SPEC §8.3). */
  reused?: number;
  /** Replies that could not be read; those questions are asked next run. */
  unreadable?: number;
  error?: string;
}

/** One question a pass asks: a paragraph, or the whole draft. */
interface Question {
  key: string;
  chunk: string | null;
  window: Window | null;
}

/**
 * Run the given passes against the open document. Saves first, so every run
 * records the revision it examined.
 */
export async function runPasses(
  passes: Pass[],
  options: { override?: string | null; fresh?: boolean } = {},
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
  const paras = paragraphs(draft);
  const wins = windows(paras, draft);

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
  // Each provider has its own limit under the run's; agy hits rate limits
  // at 16 calls, and DeepSeek should not wait for it.
  const limits = callLimits(config, MAX_CALLS);

  /** A pass on Jev (SPEC §8.4). One answer is one paragraph: every request
   *  for it. The answer is saved when its last request returns. There are
   *  no candidates and no verifier; the keep threshold does that work. */
  const runJev = async (pass: Pass, name: string, resolved: Resolved, limit: Limit): Promise<RunReport> => {
    let settings: JevSettings | null = null;
    let refusal: string | null;
    try {
      settings = jevSettings(pass, resolved.provider);
      refusal = cannotRun(pass, settings);
    } catch (e) {
      refusal = e instanceof Error ? e.message : String(e);
    }
    const run = await store.startRun(docId, revisionId, pass.slug, pass.name, name, resolved.provider.model ?? null);
    if (refusal !== null || settings === null) {
      const message = refusal ?? `${pass.name}: no [jev] settings`;
      await store.finishRun(run.id, "error", message, NONE);
      return { pass: pass.name, findings: 0, error: message };
    }
    const using = settings;

    const calls: Call[] = [];
    let failure: string | null = null;
    let stored = 0;
    let unreadable = 0;
    let unread: string | null = null;

    const keys = await passKeys(pass, name, resolved, system, paras, draft);
    const saved = options.fresh ? new Set<string>() : new Set(await store.reviewedKeys(docId, pass.slug));
    const asked = new Map<string, number>();
    keys.forEach((key, i) => {
      if (!saved.has(key) && !asked.has(key)) asked.set(key, i);
    });
    const reused = keys.length - asked.size;
    void log.write(
      "info",
      `${pass.name}: ${asked.size} paragraph(s) on ${name}, ${reused} answer(s) reused, keep ${using.keep}`,
    );

    const points = Array.from(draft);
    const starts = paragraphStarts(draft);
    const seconds = Math.max(resolved.provider.timeoutSecs, 1);
    // Each request is one call. It waits for a slot of its provider, then
    // for a slot of the run, as every call does. After a failure the pass
    // asks nothing more.
    const ask: Ask = (state, questions) =>
      limit(async () => {
        if (failure !== null) return null;
        asking(pass.name, 1);
        try {
          const reply = await deadline(
            jev.ask(name, resolved.provider, state, questions),
            (seconds + 30) * 1000,
            name,
          );
          calls.push({ tokens: reply.tokens, costUsd: reply.costUsd });
          return reply;
        } finally {
          asking(pass.name, -1);
        }
      }, 1);

    await Promise.all(
      [...asked].map(async ([key, i]) => {
        try {
          const found = await paragraphFindings(pass, using, paras[i]!, { points, start: starts[i]! }, ask);
          if (found === null) return;
          await store.addFindings(run.id, docId, key, found);
          stored += found.length;
          if (found.length > 0) app.showMargin();
          await app.loadFindings();
        } catch (e) {
          if (e instanceof Unreadable) {
            unreadable += 1;
            unread ??= e.message;
            void log.write("error", `${pass.name}: ${e.message}; asked again next run`);
            return;
          }
          failure ??= e instanceof Error ? e.message : String(e);
        }
      }),
    );
    if (asked.size > 0 && unreadable === asked.size) failure ??= unread;

    if (failure !== null) {
      await store.finishRun(run.id, "error", failure, total(calls));
      void log.write("error", `${pass.name}: ${failure}`);
      return { pass: pass.name, findings: stored, reused, unreadable, error: failure };
    }
    await store.retainFindings(run.id, keys);
    await app.loadFindings();
    await store.finishRun(run.id, "done", null, total(calls));
    void log.write("info", `${pass.name}: done, ${stored} new finding(s)`);
    return { pass: pass.name, findings: stored, reused, unreadable };
  };

  const runOne = async (pass: Pass): Promise<RunReport> => {
    const name = providerFor(config, pass, options.override);
    const limit = limits(name);
    let resolved: Resolved;
    try {
      resolved = withPass(resolve(config, name), pass);
    } catch (e) {
      const message = e instanceof ProviderError ? e.message : String(e);
      const run = await store.startRun(docId, revisionId, pass.slug, pass.name, name, null);
      await store.finishRun(run.id, "error", message, NONE);
      return { pass: pass.name, findings: 0, error: message };
    }
    if (resolved.provider.kind === "jev") return runJev(pass, name, resolved, limit);

    const run = await store.startRun(
      docId,
      revisionId,
      pass.slug,
      pass.name,
      name,
      resolved.provider.model ?? null,
    );

    const calls: Call[] = [];
    let failure: string | null = null;
    const verified = verifies(resolved);
    const priority = verified ? 1 : 0;
    const repeats = new Repeats(draft);
    // Items the schema rejected, over the whole pass. One bad item in one
    // reply is dropped; a pass where every item was bad has failed.
    let fit = 0;
    let rejected = 0;
    let why: string | null = null;
    let stored = 0;
    // Replies with no readable array. Each fails its own call, which is not
    // saved and is asked again next run; the pass goes on (SPEC §8.3).
    let unreadable = 0;
    let unread: string | null = null;

    // The questions this pass asks, each with the key of its answer.
    const keys = await passKeys(pass, name, resolved, system, paras, draft);
    const questions: Question[] =
      pass.scope === "paragraph"
        ? paras.map((p, i) => ({ key: keys[i]!, chunk: p, window: windowOf(wins, i) }))
        : [{ key: keys[0]!, chunk: null, window: null }];

    // Skip what is already answered, and ask a repeated question once.
    const saved = options.fresh ? new Set<string>() : new Set(await store.reviewedKeys(docId, pass.slug));
    const asked = new Map<string, Question>();
    for (const q of questions) if (!saved.has(q.key) && !asked.has(q.key)) asked.set(q.key, q);
    const reused = questions.length - asked.size;
    void log.write(
      "info",
      `${pass.name}: ${asked.size} call(s), ${reused} answer(s) reused, ${pass.scope} scope, ` +
        `thinking ${resolved.provider.thinking ?? "default"}`,
    );

    /** Store one answer. `reload` puts it in the margin at once. */
    const save = async (key: string, found: NewFinding[], reload = true) => {
      await store.addFindings(run.id, docId, key, found);
      stored += found.length;
      if (found.length > 0) app.showMargin();
      if (reload) await app.loadFindings();
    };

    // A verified pass gathers each answer's candidates, then verifies them a
    // window at a time. Any other pass stores each answer as it comes.
    const pending: { q: Question; found: NewFinding[] }[] = [];
    const call = async (q: Question) => {
      try {
        const text = await limit(async () => {
          // After a failure the pass asks nothing more. Calls already in
          // flight finish, and what they find is kept.
          if (failure !== null) return null;
          asking(pass.name, 1);
          try {
            const context = q.window?.text ?? draft;
            return await ask(resolved, system, buildPrompt(pass, context, q.chunk, q.window?.excerpt), calls);
          } finally {
            asking(pass.name, -1);
          }
        }, priority);
        if (text === null) return;
        let read: ReturnType<typeof readFindings>;
        try {
          read = readFindings(text, resolved.name);
        } catch (e) {
          unreadable += 1;
          unread ??= e instanceof Error ? e.message : String(e);
          void log.write("error", `${pass.name}: ${unread}; asked again next run`);
          return;
        }
        fit += read.found.length;
        if (read.rejected > 0) {
          rejected += read.rejected;
          why ??= read.why;
          void log.write("error", `${pass.name}: dropped ${read.rejected} finding(s): ${read.why}`);
        }
        if (!verified) return await save(q.key, read.found);
        const found = repeats.take(q.chunk === null ? read.found : inParagraph(read.found, q.chunk));
        // Nothing to verify: the answer is saved as it is.
        if (found.length === 0) await save(q.key, [], false);
        else pending.push({ q, found });
      } catch (e) {
        failure ??= e instanceof Error ? e.message : String(e);
      }
    };
    await Promise.all([...asked.values()].map(call));
    if (fit === 0 && rejected > 0) failure ??= unfit(resolved.name, rejected, why);
    if (asked.size > 0 && unreadable === asked.size) failure ??= unread;

    // Verify a window's candidates together, as the measured design did.
    const groups = new Map<string, { context: string; items: typeof pending }>();
    for (const item of pending) {
      const context = item.q.window?.text ?? draft;
      const group = groups.get(context) ?? { context, items: [] };
      group.items.push(item);
      groups.set(context, group);
    }
    await Promise.all(
      [...groups.values()].map(async ({ context, items }) => {
        const flat = items.flatMap((item) => item.found.map((finding) => ({ key: item.q.key, finding })));
        const kept = new Set(
          await verify(pass, resolved, context, flat.map((x) => x.finding), calls, limit, asking),
        );
        void log.write("info", `${pass.name}: kept ${kept.size} of ${flat.length} candidate(s)`);
        try {
          for (const item of items) await save(item.q.key, item.found.filter((f) => kept.has(f)), false);
          await app.loadFindings();
        } catch (e) {
          failure ??= e instanceof Error ? e.message : String(e);
        }
      }),
    );

    if (failure !== null) {
      // What arrived before the failure is stored. Nothing is superseded, so
      // a failed run does not empty the margin. Keep what was spent too.
      await store.finishRun(run.id, "error", failure, total(calls));
      void log.write("error", `${pass.name}: ${failure}`);
      return { pass: pass.name, findings: stored, reused, unreadable, error: failure };
    }
    // Findings on paragraphs that changed or went away are replaced now.
    await store.retainFindings(run.id, questions.map((q) => q.key));
    await app.loadFindings();
    await store.finishRun(run.id, "done", null, total(calls));
    void log.write("info", `${pass.name}: done, ${stored} new finding(s)`);
    return { pass: pass.name, findings: stored, reused, unreadable };
  };

  report();
  // Passes that think go first: their calls are the slowest (SPEC §8.3). An
  // unknown provider counts as thinking; the pass reports it when it runs. A
  // pass on Jev does not think.
  const thinks = (p: Pass) => {
    const provider = config.providers[providerFor(config, p, options.override)];
    if (provider?.kind === "jev") return false;
    return (p.thinking ?? provider?.thinking ?? null) !== "off";
  };
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

/** The keys of the answers a pass gives for a draft (SPEC §8.3): one per
 *  paragraph, in order, for a paragraph-scope pass, or one for the whole
 *  draft. The runner and the review-mode markers (SPEC §12.4) both call
 *  this, so they compute the same keys. `provider` is the provider's name,
 *  and `resolved` is the provider as the pass uses it, after `withPass`. */
export async function passKeys(
  pass: Pass,
  provider: string,
  resolved: Resolved,
  system: string,
  paras: string[],
  draft: string,
): Promise<string[]> {
  const fp = resolved.provider.kind === "jev" ? await jevPrint(pass, provider, resolved) : await fingerprint({
    system,
    builder: buildPrompt(pass, "", pass.scope === "paragraph" ? "" : null),
    scope: pass.scope,
    provider,
    model: resolved.provider.model,
    thinking: resolved.provider.thinking,
    verifier: verifies(resolved) ? `${VERIFY_SYSTEM}\n${buildVerifyPrompt("", "", [])}` : null,
  });
  if (pass.scope !== "paragraph") return [await documentKey(fp, draft)];
  return Promise.all(paras.map((p, i) => paragraphKey(fp, p, i > 0 ? paras[i - 1]! : null)));
}

/** The fingerprint of a pass on Jev (SPEC §8.4). Settings that do not
 *  validate still get a fingerprint, from the table as written; the run
 *  reports them. */
function jevPrint(pass: Pass, provider: string, resolved: Resolved): Promise<string> {
  let settings: { method: string; keep: number; note: string };
  try {
    settings = jevSettings(pass, resolved.provider);
  } catch {
    settings = { method: String(pass.jev?.method), keep: Number(pass.jev?.keep), note: String(pass.jev?.note) };
  }
  return jevFingerprint({
    rule: pass.prompt,
    category: pass.category,
    ...settings,
    provider,
    model: resolved.provider.model,
    fixed: METHOD_FINGERPRINT,
  });
}

/** The provider as this pass uses it: the pass's thinking and ceiling win
 *  over the provider's (SPEC §8.1). */
export function withPass(resolved: Resolved, pass: Pass): Resolved {
  const provider = {
    ...resolved.provider,
    thinking: pass.thinking ?? resolved.provider.thinking ?? null,
    timeoutSecs: pass.timeoutSecs ?? resolved.provider.timeoutSecs,
  };
  return { ...resolved, provider };
}

/** A pass runs in two stages when its model does not think (SPEC §8.3). */
function verifies(resolved: Resolved): boolean {
  return resolved.provider.thinking === "off";
}

/** Three verifiers vote on a pass's candidates; the ones two keep survive.
 *  Their calls count towards the pass's usage. */
async function verify(
  pass: Pass,
  resolved: Resolved,
  draft: string,
  candidates: NewFinding[],
  calls: Call[],
  limit: Limit,
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
  const reused = reports.reduce((n, r) => n + (r.reused ?? 0), 0);
  const failed = reports.filter((r) => r.error);
  // With reused answers, the margin holds more than this run found, so the
  // count says "new".
  const kind = reused > 0 ? "new finding" : "finding";
  let found = total === 0 ? `no ${kind}s` : `${total} ${kind}${total === 1 ? "" : "s"}`;
  if (reused > 0) found += ` · ${reused} answer${reused === 1 ? "" : "s"} reused`;
  const unreadable = reports.reduce((n, r) => n + (r.error ? 0 : (r.unreadable ?? 0)), 0);
  if (unreadable > 0) found += ` · ${unreadable} unreadable repl${unreadable === 1 ? "y" : "ies"} asked again next run`;
  if (failed.length === 0) return found;
  return `${found} · ${failed.length} pass${failed.length === 1 ? "" : "es"} failed: ${failed[0].error}`;
}
