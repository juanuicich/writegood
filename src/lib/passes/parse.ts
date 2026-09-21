/** The parts of running a pass that do not touch the app: building the prompt
 *  and reading findings back out of a model reply.
 *
 *  Kept free of the store and of Tauri so it can be unit tested, and so the
 *  probe in `dev/` can exercise exactly the code the app runs. */
import type { NewFinding, Pass, Severity } from "../ipc";
import { FindingElement, outputNote } from "./schema";

/** Paragraph scope sends one call per paragraph, with the whole draft as
 *  context so the model can see what surrounds it. */
export function paragraphs(text: string): string[] {
  return text
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
}

export function buildPrompt(pass: Pass, draft: string, chunk: string | null): string {
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

const FENCE = /```([A-Za-z0-9_+-]*)[^\S\r\n]*\r?\n?([\s\S]*?)```/g;

/** The places an array might hide, best first: every ```json fence, then every
 *  plain fence, then the raw reply. A model that quotes the draft in a fence
 *  and puts the array after it is still readable this way. */
function candidates(text: string): string[] {
  const json: string[] = [];
  const plain: string[] = [];
  for (const m of text.matchAll(FENCE)) {
    (m[1]!.toLowerCase() === "json" ? json : plain).push(m[2]!);
  }
  return [...json, ...plain, text];
}

/** An array in `body`, by the index of its `[` and of its matching `]`. */
interface Span {
  start: number;
  end: number;
}

/** Every balanced array in `body`, in the order their brackets open.
 *
 *  Brackets inside a JSON string do not count, and a backslash only escapes
 *  inside a string. An array that never closes yields no span. */
function balancedArrays(body: string): Span[] {
  const spans: Span[] = [];
  const open: number[] = [];
  let inString = false;
  let escaped = false;
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (c === "\\") escaped = true;
      else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') inString = true;
    else if (c === "[") open.push(i);
    else if (c === "]") {
      const start = open.pop();
      if (start !== undefined) spans.push({ start, end: i });
    }
  }
  return spans.sort((a, b) => a.start - b.start);
}

/** The trimmed contents between an array's brackets. */
function inner(body: string, span: Span): string {
  return body.slice(span.start + 1, span.end).trim();
}

/** Findings are objects, so the array we want is empty or opens with `{`.
 *
 *  This is what tells the findings in `{"meta": {"tags": ["draft"]}, ...}`
 *  from the decoy beside them. An empty array is a normal result and stays
 *  acceptable. */
function holdsObjects(body: string, span: Span): boolean {
  const text = inner(body, span);
  return text.length === 0 || text.startsWith("{");
}

interface Scanned {
  body: string;
  spans: Span[];
}

/** Pull the findings array out of a reply that may carry a preamble, a fenced
 *  block, trailing chatter, or a wrapper object with other arrays in it.
 *
 *  Three passes over the candidates, in order: a findings array with something
 *  in it, then an empty findings array, then the reply we do not understand. */
export function extractArray(text: string): string | null {
  const scanned: Scanned[] = candidates(text).map((body) => ({
    body,
    spans: balancedArrays(body),
  }));
  const cut = (c: Scanned, span: Span) => c.body.slice(span.start, span.end + 1);

  // Findings. A model may write "nothing here: []" and then the real array,
  // so an empty array earlier in the reply must not win over this.
  for (const c of scanned) {
    for (const span of c.spans) {
      if (holdsObjects(c.body, span) && inner(c.body, span).length > 0) return cut(c, span);
    }
  }

  // An empty array. Finding nothing is a normal result.
  for (const c of scanned) {
    for (const span of c.spans) {
      if (holdsObjects(c.body, span)) return cut(c, span);
    }
  }

  // Neither, so degrade to what this used to do: the first balanced array of
  // any kind. It has to open at the candidate's first bracket, or a truncated
  // reply like `[{"a": [1]}` would quietly yield its nested array. A throw
  // names the provider; a pass with no findings looks like a clean result.
  for (const c of scanned) {
    const first = c.spans[0];
    if (first && first.start === c.body.indexOf("[")) return cut(c, first);
  }
  return null;
}

export function toFinding(el: FindingElement): NewFinding {
  return {
    quote: el.quote,
    prefix: el.prefix ?? "",
    suffix: el.suffix ?? "",
    category: el.category,
    severity: el.severity as Severity,
    note: el.note,
  };
}

/**
 * Read findings out of a model reply.
 *
 * Items that do not satisfy the schema are dropped rather than failing the
 * pass: one malformed entry should not discard the nine good ones beside it.
 */
export function parseFindings(text: string, who = "the model"): NewFinding[] {
  const json = extractArray(text);
  if (json === null) throw new Error(`${who} returned no JSON array`);

  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new Error(`${who} returned JSON that will not parse`);
  }
  if (!Array.isArray(parsed)) {
    throw new Error(`${who} returned ${typeof parsed}, not an array`);
  }

  const out: NewFinding[] = [];
  for (const raw of parsed) {
    const el = FindingElement.safeParse(raw);
    if (el.success) out.push(toFinding(el.data));
  }
  return out;
}
