/** Running editing passes over a draft (SPEC 8.3).
 *
 *  A pass is one prompt. Passes fan out across a small worker pool; findings
 *  are written to the database as each pass completes so a later failure never
 *  loses earlier work. */
import { generateText } from "ai";
import { store, type NewFinding, type Pass } from "../ipc";
import { app } from "../state.svelte";
import { resolve, providerFor, ProviderError, type Resolved } from "../providers";
import { preamble } from "./schema";
import { buildPrompt, paragraphs, parseFindings } from "./parse";

const MAX_PARALLEL = 4;

/** Both backends end at the same place: a block of text that should contain a
 *  JSON array of findings.
 *
 *  The AI SDK's `Output.array` is tempting and does not survive provider
 *  switching. An endpoint without structured-output support — DeepSeek, most
 *  local servers — returns a bare array where the SDK expects a wrapper, and
 *  the result is silently zero findings. Parsing the text ourselves is one code
 *  path with one failure mode, and it works everywhere. The cost is that
 *  findings arrive per pass rather than one at a time. */
async function collect(
  resolved: Resolved,
  system: string,
  prompt: string,
  signal: AbortSignal,
): Promise<NewFinding[]> {
  const text = resolved.runCli
    ? await resolved.runCli(`${system}\n\n${prompt}`)
    : (
        await generateText({
          model: resolved.model!,
          system,
          prompt,
          abortSignal: signal,
        })
      ).text;

  return parseFindings(text, resolved.name);
}

/** Work through `jobs` with a bounded worker pool. */
async function pool<T>(jobs: (() => Promise<T>)[], limit: number): Promise<PromiseSettledResult<T>[]> {
  const results: PromiseSettledResult<T>[] = new Array(jobs.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, jobs.length) }, async () => {
    for (;;) {
      const i = next++;
      if (i >= jobs.length) return;
      try {
        results[i] = { status: "fulfilled", value: await jobs[i]() };
      } catch (reason) {
        results[i] = { status: "rejected", reason };
      }
    }
  });
  await Promise.all(workers);
  return results;
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
  options: { override?: string | null; signal?: AbortSignal } = {},
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
  const signal = options.signal ?? new AbortController().signal;

  const jobs = passes.map((pass) => async (): Promise<RunReport> => {
    const name = providerFor(config, pass.provider, options.override);
    let resolved: Resolved;
    try {
      resolved = await resolve(config, name);
    } catch (e) {
      const message = e instanceof ProviderError ? e.message : String(e);
      const run = await store.startRun(docId, revisionId, pass.slug, pass.name, name, null);
      await store.finishRun(run.id, "error", message);
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

    try {
      const chunks = pass.scope === "paragraph" ? paragraphs(draft) : [null];
      for (const chunk of chunks) {
        const found = await collect(resolved, system, buildPrompt(pass, draft, chunk), signal);
        collected.push(...found);
      }
      if (collected.length > 0) {
        await store.addFindings(run.id, docId, collected);
      }
      await store.finishRun(run.id, "done", null);
      return { pass: pass.name, findings: collected.length };
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      // Keep whatever arrived before the failure.
      if (collected.length > 0) await store.addFindings(run.id, docId, collected);
      await store.finishRun(run.id, "error", message);
      return { pass: pass.name, findings: collected.length, error: message };
    }
  });

  const settled = await pool(jobs, MAX_PARALLEL);
  await app.loadFindings();

  return settled.map((r, i) =>
    r.status === "fulfilled"
      ? r.value
      : { pass: passes[i].name, findings: 0, error: String(r.reason) },
  );
}

export function summarise(reports: RunReport[]): string {
  const total = reports.reduce((n, r) => n + r.findings, 0);
  const failed = reports.filter((r) => r.error);
  const found = total === 0 ? "no findings" : `${total} finding${total === 1 ? "" : "s"}`;
  if (failed.length === 0) return found;
  return `${found} · ${failed.length} pass${failed.length === 1 ? "" : "es"} failed: ${failed[0].error}`;
}
