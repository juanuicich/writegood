/** Running editing passes over a draft (SPEC 8.3).
 *
 *  A pass is one prompt. Passes fan out across a small worker pool; findings
 *  are written to the database as each pass completes so a later failure never
 *  loses earlier work. */
import { streamText, Output } from "ai";
import { store, type NewFinding, type Pass, type Severity } from "../ipc";
import { app } from "../state.svelte";
import { resolve, providerFor, ProviderError, type Resolved } from "../providers";
import { FindingElement, preamble, outputNote } from "./schema";

const MAX_PARALLEL = 4;

/** Paragraph scope sends one call per paragraph, with the whole draft as
 *  context so the model can see what surrounds it. */
function paragraphs(text: string): string[] {
  return text
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
}

function buildPrompt(pass: Pass, draft: string, chunk: string | null): string {
  const parts = [pass.prompt.trim(), outputNote(), "", "--- the draft ---", draft];
  if (chunk !== null) {
    parts.push(
      "",
      "--- examine only this paragraph ---",
      chunk,
      "",
      "Report problems in that paragraph only. The rest of the draft is context.",
    );
  }
  return parts.join("\n");
}

async function viaApi(
  resolved: Resolved,
  system: string,
  prompt: string,
  signal: AbortSignal,
  onFinding: (f: NewFinding) => void,
): Promise<void> {
  const { elementStream } = streamText({
    model: resolved.model!,
    system,
    prompt,
    abortSignal: signal,
    output: Output.array({ element: FindingElement }),
  });
  for await (const el of elementStream) {
    onFinding(toFinding(el));
  }
}

async function viaCli(
  resolved: Resolved,
  system: string,
  prompt: string,
  onFinding: (f: NewFinding) => void,
): Promise<void> {
  const full = [
    system,
    "",
    prompt,
    "",
    "Reply with a JSON array and nothing else. Each item has the keys quote,",
    "prefix, suffix, category, severity, note. An empty array is a valid reply.",
  ].join("\n");

  const out = await resolved.runCli!(full);
  const json = extractArray(out);
  if (json === null) {
    throw new Error(`${resolved.name} returned no JSON array`);
  }
  const parsed = JSON.parse(json);
  if (!Array.isArray(parsed)) throw new Error(`${resolved.name} returned ${typeof parsed}, not an array`);
  for (const raw of parsed) {
    const el = FindingElement.safeParse(raw);
    if (el.success) onFinding(toFinding(el.data));
  }
}

/** Pull the first JSON array out of a CLI reply that may carry a preamble.
 *  The API backend does not need this; the CLI backend usually does. */
export function extractArray(text: string): string | null {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fenced ? fenced[1] : text;
  const start = body.indexOf("[");
  if (start < 0) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < body.length; i++) {
    const c = body[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (c === "\\") {
      escaped = true;
      continue;
    }
    if (c === '"') inString = !inString;
    if (inString) continue;
    if (c === "[") depth++;
    else if (c === "]") {
      depth--;
      if (depth === 0) return body.slice(start, i + 1);
    }
  }
  return null;
}

function toFinding(el: FindingElement): NewFinding {
  return {
    quote: el.quote,
    prefix: el.prefix ?? "",
    suffix: el.suffix ?? "",
    category: el.category,
    severity: el.severity as Severity,
    note: el.note,
  };
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
    const collect = (f: NewFinding) => collected.push(f);

    try {
      const chunks = pass.scope === "paragraph" ? paragraphs(draft) : [null];
      for (const chunk of chunks) {
        const prompt = buildPrompt(pass, draft, chunk);
        if (resolved.runCli) await viaCli(resolved, system, prompt, collect);
        else await viaApi(resolved, system, prompt, signal, collect);
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
