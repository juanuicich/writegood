import { describe, expect, test } from "bun:test";
import { limiter } from "./limit";

/** A job that stays open until the test lets it finish. */
function gate() {
  let open!: () => void;
  const done = new Promise<void>((resolve) => (open = resolve));
  return { open, done };
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("limiter", () => {
  test("never runs more than the limit at once", async () => {
    const limit = limiter(3);
    let running = 0;
    let most = 0;
    const jobs = Array.from({ length: 10 }, () =>
      limit(async () => {
        running += 1;
        most = Math.max(most, running);
        await tick();
        running -= 1;
      }),
    );
    await Promise.all(jobs);
    expect(most).toBe(3);
  });

  test("starts queued jobs in the order they were queued", async () => {
    const limit = limiter(1);
    const order: number[] = [];
    await Promise.all([1, 2, 3, 4].map((n) => limit(async () => void order.push(n))));
    expect(order).toEqual([1, 2, 3, 4]);
  });

  test("a waiting job with a lower priority starts first", async () => {
    const limit = limiter(1);
    const busy = gate();
    const order: string[] = [];
    const jobs = [
      limit(() => busy.done),
      limit(async () => void order.push("quick 1")),
      limit(async () => void order.push("quick 2")),
      limit(async () => void order.push("slow"), 0),
    ];
    busy.open();
    await Promise.all(jobs);
    expect(order).toEqual(["slow", "quick 1", "quick 2"]);
  });

  test("a failed job frees its slot and passes its error on", async () => {
    const limit = limiter(1);
    const failed = limit(async () => {
      throw new Error("no");
    });
    const after = limit(async () => "yes");
    await expect(failed).rejects.toThrow("no");
    expect(await after).toBe("yes");
  });

  test("a new job starts as soon as a slot frees", async () => {
    const limit = limiter(2);
    const a = gate();
    const b = gate();
    let third = false;
    const jobs = [limit(() => a.done), limit(() => b.done), limit(async () => void (third = true))];
    await tick();
    expect(third).toBe(false);
    a.open();
    await jobs[0];
    await tick();
    expect(third).toBe(true);
    b.open();
    await Promise.all(jobs);
  });
});
