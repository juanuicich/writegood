/** Post-process a bench2 run with code-only filters, and write a new run file.
 *
 *  Usage: bun filter.ts in.json out.json [--in-paragraph] [--dedupe]
 *
 *  --in-paragraph  a paragraph-scope call keeps only findings whose quote is
 *                  inside the paragraph it examined
 *  --dedupe        within a pass, keep one finding per quote that overlaps an
 *                  earlier one
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const REPO = "<repo>";
const { paragraphs } = await import(`${REPO}/src/lib/passes/parse`);
const S = "<scratch>";
const [, , inFile, outFile] = process.argv;
const inPara = process.argv.includes("--in-paragraph");
const dedupe = process.argv.includes("--dedupe");

const run = JSON.parse(readFileSync(inFile!, "utf8"));
const draftPath = (d: string) => [join(S, "eval", d), join(S, d), join(homedir(), ".writegood/documents", d)].find(existsSync)!;
const docPasses = new Set(["paragraph-order", "topic-flow", "length"]);

let before = 0, after = 0;
for (const r of run.results) {
  const text = readFileSync(draftPath(r.draft), "utf8");
  const paras = paragraphs(text);
  const seen = new Map<string, string[]>();
  for (const c of r.calls) {
    before += c.findings.length;
    const docCall = run.scope === "document" || docPasses.has(c.pass);
    c.findings = c.findings.filter((f: any) => {
      if (inPara && !docCall && !paras[c.chunk]?.includes(f.quote.replace(/\*+/g, ""))) return false;
      if (dedupe) {
        const q = f.quote.replace(/\*+/g, "").trim().toLowerCase();
        const list = seen.get(c.pass) ?? [];
        // A duplicate only within one call or when the quote occurs once in
        // the draft; a quote that occurs twice may be two real problems.
        const once = text.toLowerCase().split(q).length === 2;
        if (list.some((x) => (x.includes(q) || q.includes(x)) && once)) return false;
        list.push(q);
        seen.set(c.pass, list);
      }
      return true;
    });
    after += c.findings.length;
  }
}
run.label += `${inPara ? " +in-paragraph" : ""}${dedupe ? " +dedupe" : ""}`;
writeFileSync(outFile!, JSON.stringify(run));
console.log(`${before} → ${after} findings`);
