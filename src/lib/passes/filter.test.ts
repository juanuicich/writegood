import { describe, expect, test } from "bun:test";
import { inParagraph, Repeats } from "./filter";

const f = (quote: string) => ({ quote });

describe("inParagraph", () => {
  const paragraph = "It was decided by the committee. The **matter** was tabled.";

  test("keeps a quote from the paragraph and drops one from elsewhere", () => {
    const out = inParagraph([f("It was decided"), f("No resolution was arrived at")], paragraph);
    expect(out.map((x) => x.quote)).toEqual(["It was decided"]);
  });

  test("ignores Markdown marks on either side", () => {
    expect(inParagraph([f("The matter was tabled")], paragraph)).toHaveLength(1);
    expect(inParagraph([f("**It was decided**")], paragraph)).toHaveLength(1);
  });
});

describe("Repeats", () => {
  const draft = "It was decided in 2023. The board meets. The board decides. very well.";

  test("drops a quote that repeats an earlier one", () => {
    const r = new Repeats(draft);
    expect(r.take([f("It was decided in 2023")])).toHaveLength(1);
    expect(r.take([f("It was decided")])).toHaveLength(0);
    expect(r.take([f("it was decided in 2023")])).toHaveLength(0);
  });

  test("keeps a repeated quote that occurs more than once in the draft", () => {
    const r = new Repeats(draft);
    expect(r.take([f("The board"), f("The board")])).toHaveLength(2);
  });

  test("keeps different quotes", () => {
    const r = new Repeats(draft);
    expect(r.take([f("It was decided"), f("very well")])).toHaveLength(2);
  });
});
