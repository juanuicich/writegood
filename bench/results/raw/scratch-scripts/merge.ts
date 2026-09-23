/** Compose a hybrid run: paragraph passes from one run, document passes from
 *  another. Wall per draft is the slower of the two parts, since they run at
 *  the same time; the app shows each part's findings as they arrive. */
import { readFileSync, writeFileSync } from "node:fs";
const [, , fastFile, docFile, outFile] = process.argv;
const DOC = new Set((process.env.DOC ?? "paragraph-order,topic-flow,length").split(","));
const fast = JSON.parse(readFileSync(fastFile!, "utf8"));
const doc = JSON.parse(readFileSync(docFile!, "utf8"));
for (const r of fast.results) {
  const d = doc.results.find((x: any) => x.draft === r.draft);
  const docCalls = d.calls.filter((c: any) => DOC.has(c.pass));
  const docWall = Math.max(...docCalls.map((c: any) => c.start + c.secs));
  // The fast part's wall without its own document calls: assume they are gone.
  r.fastWall = r.wall;
  r.calls = r.calls.filter((c: any) => !DOC.has(c.pass)).concat(docCalls);
  r.docWall = docWall;
  r.wall = Math.max(r.wall, docWall);
  r.cost = r.calls.reduce((n: number, c: any) => n + c.cost, 0) + (r.verifyCost ?? 0);
}
fast.label += ` | document passes from: ${doc.label}`;
writeFileSync(outFile!, JSON.stringify(fast));
for (const r of fast.results) console.log(`  ${r.draft.padEnd(16)} first findings ~${r.fastWall.toFixed(0)}s, all ${r.wall.toFixed(0)}s, $${r.cost.toFixed(4)}`);
