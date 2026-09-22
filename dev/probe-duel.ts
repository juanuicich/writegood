/** Run one duel against a real judge, outside the app.
 *
 *  Uses the app's own shuffle, prompt and parser, and the app's own network
 *  client — the Rust `probe` binary. The two passages are fixed: the first is
 *  deliberately nominalised, the second is the same thought written plainly,
 *  so the right answer is known before the judge is asked.
 *
 *  Usage: bun dev/probe-duel.ts [provider] [--raw] [--repeat N]
 */
import { mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { judgePrompt, originalWon, parseVerdict, shuffle } from "../src/lib/duel/judge";

const ORIGINAL =
  "It was decided by the committee that a determination would be made regarding " +
  "the proposal. Very few of the members had actually read it.";
const REWRITE =
  "The committee decided to decide about the proposal later. Barely any of them " +
  "had read it.";

/** Ask through the app's own client. */
async function ask(provider: string | undefined, system: string, prompt: string) {
  const dir = mkdtempSync(join(tmpdir(), "writegood-duel-"));
  const systemFile = join(dir, "system.txt");
  const promptFile = join(dir, "prompt.txt");
  writeFileSync(systemFile, system);
  writeFileSync(promptFile, prompt);

  const argv = ["run", "-q", "--example", "probe", "--", "--system", systemFile, "--prompt", promptFile];
  if (provider) argv.push("--provider", provider);

  const child = Bun.spawn(["cargo", ...argv], {
    cwd: join(import.meta.dir, "..", "src-tauri"),
    stdout: "pipe",
    stderr: "inherit",
  });
  const text = await new Response(child.stdout).text();
  if ((await child.exited) !== 0) throw new Error("probe failed");
  return text;
}

const args = process.argv.slice(2);
const raw = args.includes("--raw");
const repeatAt = args.indexOf("--repeat");
const repeat = repeatAt >= 0 ? Number(args[repeatAt + 1] ?? 1) : 1;
const name = args.find((a) => !a.startsWith("--") && a !== String(repeat));

console.log(`judge    ${name ?? "as configured"}`);
console.log(
  `prompt   ${/json/i.test(judgePrompt("x", "y").prompt) ? "says json" : "DOES NOT SAY JSON"}\n`,
);

const { system } = judgePrompt("x", "y");

if (raw) {
  const { aText, bText } = shuffle(ORIGINAL, REWRITE);
  const { prompt } = judgePrompt(aText, bText);
  console.log("--- system ---\n" + system + "\n\n--- prompt ---\n" + prompt + "\n");
  console.log("--- reply ---\n" + (await ask(name, system, prompt)));
  process.exit(0);
}

const wins = { original: 0, rewrite: 0, ties: 0 };
for (let i = 0; i < repeat; i++) {
  const { aText, bText, aIsOriginal } = shuffle(ORIGINAL, REWRITE);
  const { prompt } = judgePrompt(aText, bText);
  const text = await ask(name, system, prompt);
  let verdict;
  try {
    verdict = parseVerdict(text, name ?? "the judge");
  } catch (e) {
    console.log(`${i + 1}. UNPARSEABLE: ${e instanceof Error ? e.message : e}`);
    console.log("--- reply ---\n" + text + "\n--- end ---\n");
    continue;
  }
  const won = originalWon(verdict.verdict, aIsOriginal);
  if (won === null) wins.ties += 1;
  else if (won) wins.original += 1;
  else wins.rewrite += 1;
  console.log(
    `${i + 1}. original shown as ${aIsOriginal ? "A" : "B"}, judge chose ${verdict.verdict} → ` +
      `${won === null ? "tie" : won ? "original" : "rewrite"}`,
  );
  console.log(`   ${verdict.reason}\n`);
}
if (repeat > 1) {
  console.log(`original ${wins.original}, rewrite ${wins.rewrite}, ties ${wins.ties}`);
}
