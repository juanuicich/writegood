import { describe, expect, test } from "bun:test";
import { documentKey, fingerprint, paragraphKey } from "./keys";

const base = {
  system: "You are a copyeditor.",
  builder: "--- the draft ---\n\n--- the task ---\nFind buried verbs.",
  scope: "paragraph",
  provider: "deepseek",
  model: "deepseek-flash",
  thinking: "off",
  verifier: "verify",
};

describe("keys", () => {
  test("are stable hex SHA-256 hashes", async () => {
    const fp = await fingerprint(base);
    expect(fp).toMatch(/^[0-9a-f]{64}$/);
    expect(await fingerprint({ ...base })).toBe(fp);
  });

  test("the fingerprint changes with anything that can change an answer", async () => {
    const fp = await fingerprint(base);
    for (const change of [
      { system: "You are an editor." },
      { builder: "--- the draft ---\n\n--- the task ---\nFind passives." },
      { scope: "document" },
      { provider: "other" },
      { model: "deepseek-v4-pro" },
      { thinking: "high" },
      { verifier: null },
    ]) {
      expect(await fingerprint({ ...base, ...change })).not.toBe(fp);
    }
  });

  test("a paragraph key depends on the paragraph and the one before it", async () => {
    const fp = await fingerprint(base);
    const k = await paragraphKey(fp, "Two.", "One.");
    expect(await paragraphKey(fp, "Two.", "One.")).toBe(k);
    expect(await paragraphKey(fp, "Two!", "One.")).not.toBe(k);
    expect(await paragraphKey(fp, "Two.", "One!")).not.toBe(k);
    expect(await paragraphKey(fp, "Two.", null)).not.toBe(k);
  });

  test("parts cannot run into each other", async () => {
    const fp = await fingerprint(base);
    expect(await paragraphKey(fp, "b", "a")).not.toBe(await paragraphKey(fp, "", "ab"));
  });

  test("a document key depends on the whole draft", async () => {
    const fp = await fingerprint(base);
    expect(await documentKey(fp, "One.\n\nTwo.")).not.toBe(await documentKey(fp, "One.\n\nTwo!"));
    expect(await documentKey(fp, "x")).not.toBe(await paragraphKey(fp, "x", null));
  });
});
