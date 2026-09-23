/** Keys for saved answers (SPEC §8.3).
 *
 *  A key is a SHA-256 hash. Its parts are joined with a NUL, which no draft
 *  or prompt contains, so two different lists of parts cannot join to the
 *  same text. */

async function sha256(parts: string[]): Promise<string> {
  const bytes = new TextEncoder().encode(parts.join("\u0000"));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Everything about a pass, other than the text, that can change its answer:
 *  the system preamble (which carries the rules), the pass prompt and scope,
 *  the provider and model, the thinking setting, and the verifier's prompt
 *  when the pass is verified. The output note is part of the prompt builder,
 *  so `builder` is a prompt built from empty text. */
export function fingerprint(parts: {
  system: string;
  builder: string;
  scope: string;
  provider: string;
  model: string | null | undefined;
  thinking: string | null | undefined;
  verifier: string | null;
}): Promise<string> {
  return sha256([
    "pass",
    parts.system,
    parts.builder,
    parts.scope,
    parts.provider,
    parts.model ?? "",
    parts.thinking ?? "",
    parts.verifier ?? "",
  ]);
}

/** A paragraph-scope answer: the paragraph and the one before it. */
export function paragraphKey(fp: string, paragraph: string, previous: string | null): Promise<string> {
  return sha256(["paragraph", fp, previous ?? "", paragraph]);
}

/** A document-scope answer: the whole draft. */
export function documentKey(fp: string, draft: string): Promise<string> {
  return sha256(["document", fp, draft]);
}
