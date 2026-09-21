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

/** Pull the first JSON array out of a reply that may carry a preamble, a
 *  fenced block, or trailing chatter. */
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
