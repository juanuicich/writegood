import { describe, expect, test } from "bun:test";
import { hint, STEPS, type Situation } from "./hints";

const writing: Situation = { doc: true, findings: false, focused: false, mode: "write" };
const found: Situation = { ...writing, findings: true };
const focused: Situation = { ...found, focused: true };
const reviewing: Situation = { ...focused, mode: "review" };

/** Every action up to, and not including, the named one. */
const before = (action: string) => STEPS.slice(0, STEPS.findIndex((s) => s.action === action)).map((s) => s.action);

describe("hint", () => {
  test("the first hint names the command bar key", () => {
    expect(hint([], writing, "mac")).toBe("Press ⌘K to open the command bar.");
    expect(hint([], writing, "linux")).toBe("Press Ctrl+K to open the command bar.");
  });

  test("each action unlocks the next step", () => {
    expect(hint(["palette"], writing, "mac")).toBe("Press ⌘R to run the passes.");
    expect(hint(before("select"), found, "mac")).toBe("Press ⌥↓ to go to the next finding.");
    expect(hint(before("review"), focused, "mac")).toBe("Press Esc to enter review mode.");
    expect(hint(before("mark"), reviewing, "mac")).toBe(
      "Press d to dismiss the finding, or x to mark it addressed.",
    );
    expect(hint(before("move"), reviewing, "mac")).toBe("Press j for the next finding and k for the previous.");
    expect(hint(before("write"), reviewing, "mac")).toBe("Press i to go back to writing.");
    expect(hint(before("history"), writing, "windows")).toBe("Press Ctrl+Y to see the revisions.");
    expect(hint(before("duel"), writing, "mac")).toBe("Press ⌘D to duel the paragraph under the cursor.");
    expect(hint(before("find"), writing, "mac")).toBe("Press ⌘F to find text.");
    expect(hint(before("help"), writing, "linux")).toBe("Press Ctrl+? to open the help.");
  });

  test("an action taken early does not skip the steps before it", () => {
    expect(hint(["help", "find"], writing, "mac")).toBe("Press ⌘K to open the command bar.");
  });

  test("a step whose action cannot work now shows nothing", () => {
    expect(hint(before("select"), writing, "mac")).toBeNull();
    expect(hint(before("review"), found, "mac")).toBeNull();
    expect(hint(before("mark"), { ...reviewing, focused: false }, "mac")).toBeNull();
    expect(hint(before("history"), reviewing, "mac")).toBeNull();
  });

  test("with every action taken, no hint shows", () => {
    const all = STEPS.map((s) => s.action);
    for (const s of [writing, found, focused, reviewing]) expect(hint(all, s, "mac")).toBeNull();
  });
});
