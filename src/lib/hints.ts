/** The hints in the status bar (SPEC §12.7). The app shows the use of the
 *  app one step at a time. Each step names one action and its key. When the
 *  author takes that action, by any route, the next step shows. */
import { platform, shortcut, type Platform } from "./shortcuts";

/** The actions the hints teach, as Rust stores them. */
export type Action =
  | "palette"
  | "run"
  | "select"
  | "review"
  | "mark"
  | "move"
  | "write"
  | "history"
  | "duel"
  | "find"
  | "help";

/** What the window shows now. A step shows only when its action can work. */
export interface Situation {
  doc: boolean;
  findings: boolean;
  focused: boolean;
  mode: "write" | "review";
}

interface Step {
  action: Action;
  keys: string;
  text: (key: string) => string;
  when: (s: Situation) => boolean;
}

export const STEPS: readonly Step[] = [
  { action: "palette", keys: "Mod-k", text: (k) => `Press ${k} to open the command bar.`, when: () => true },
  { action: "run", keys: "Mod-r", text: (k) => `Press ${k} to run the passes.`, when: (s) => s.doc },
  {
    action: "select",
    keys: "Alt-ArrowDown",
    text: (k) => `Press ${k} to go to the next finding.`,
    when: (s) => s.findings,
  },
  {
    action: "review",
    keys: "Escape",
    text: (k) => `Press ${k} to enter review mode.`,
    when: (s) => s.focused && s.mode === "write",
  },
  {
    action: "mark",
    keys: "d",
    text: (k) => `Press ${k} to dismiss the finding, or x to mark it addressed.`,
    when: (s) => s.focused && s.mode === "review",
  },
  {
    action: "move",
    keys: "j",
    text: (k) => `Press ${k} for the next finding and k for the previous.`,
    when: (s) => s.findings && s.mode === "review",
  },
  { action: "write", keys: "i", text: (k) => `Press ${k} to go back to writing.`, when: (s) => s.mode === "review" },
  {
    action: "history",
    keys: "Mod-y",
    text: (k) => `Press ${k} to see the revisions.`,
    when: (s) => s.doc && s.mode === "write",
  },
  {
    action: "duel",
    keys: "Mod-d",
    text: (k) => `Press ${k} to duel the paragraph under the cursor.`,
    when: (s) => s.doc && s.mode === "write",
  },
  { action: "find", keys: "Mod-f", text: (k) => `Press ${k} to find text.`, when: (s) => s.doc && s.mode === "write" },
  { action: "help", keys: "Mod-?", text: (k) => `Press ${k} to open the help.`, when: (s) => s.mode === "write" },
];

/** The hint to show, or null. The step is the first one whose action the
 *  author has not taken. When that action cannot work now, nothing shows:
 *  a later step never jumps the queue. */
export function hint(done: readonly string[], s: Situation, os: Platform = platform): string | null {
  const step = STEPS.find((st) => !done.includes(st.action));
  if (!step || !step.when(s)) return null;
  return step.text(shortcut(step.keys, os));
}
