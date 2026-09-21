import { describe, expect, test } from "bun:test";
import { deadline } from "./deadline";

describe("deadline", () => {
  test("passes a value through when the work finishes in time", async () => {
    await expect(deadline(Promise.resolve("done"), 500, "prov")).resolves.toBe("done");
  });

  test("passes the original failure through rather than masking it", async () => {
    const boom = Promise.reject(new Error("provider said no"));
    await expect(deadline(boom, 500, "prov")).rejects.toThrow("provider said no");
  });

  test("rejects when the work never settles, naming who and the seconds", async () => {
    // The case that matters: a fetch that ignores its abort signal and leaves
    // the promise pending. Without this the run sits at `running` for ever.
    const never = new Promise<string>(() => {});
    await expect(deadline(never, 30, "deepseek")).rejects.toThrow(
      /deepseek did not answer within 0s/,
    );
  });

  test("a slow but finished call still wins", async () => {
    const slow = new Promise<string>((r) => setTimeout(() => r("late"), 10));
    await expect(deadline(slow, 300, "prov")).resolves.toBe("late");
  });
});
