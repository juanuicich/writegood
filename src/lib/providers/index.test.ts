import { describe, expect, test } from "bun:test";
import type { Config, Provider } from "../ipc";
import { callLimits, providerFor } from "./index";

const cli = (maxInFlight?: number): Provider => ({ kind: "cli", command: "agy", args: [], timeoutSecs: 180, maxInFlight });
const net: Provider = { kind: "openai-compatible", args: [], timeoutSecs: 180 };

const config = {
  defaultProvider: "deepseek",
  providers: { deepseek: net, agy: cli(8), odd: cli(0) },
} as unknown as Config;

/** A job that stays open until the test lets it finish. */
function gate() {
  let open!: () => void;
  const done = new Promise<void>((resolve) => (open = resolve));
  return { open, done };
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

/** Queue `n` jobs that stay open, and count how many have started. */
function fill(limit: ReturnType<ReturnType<typeof callLimits>>, n: number, hold: Promise<void>) {
  const started = { n: 0 };
  const jobs = Array.from({ length: n }, () =>
    limit(async () => {
      started.n += 1;
      await hold;
    }),
  );
  return { started, jobs };
}

describe("callLimits", () => {
  test("a provider's calls stay within its max_in_flight", async () => {
    const hold = gate();
    const agy = fill(callLimits(config, 32)("agy"), 20, hold.done);
    await tick();
    expect(agy.started.n).toBe(8);
    hold.open();
    await Promise.all(agy.jobs);
    expect(agy.started.n).toBe(20);
  });

  test("a DeepSeek pass is not held to agy's limit", async () => {
    const limits = callLimits(config, 32);
    const hold = gate();
    const agy = fill(limits("agy"), 20, hold.done);
    const deepseek = fill(limits("deepseek"), 20, hold.done);
    await tick();
    expect(agy.started.n).toBe(8);
    expect(deepseek.started.n).toBe(20);
    hold.open();
    await Promise.all([...agy.jobs, ...deepseek.jobs]);
  });

  test("the run as a whole never passes its bound", async () => {
    const limits = callLimits(config, 10);
    const hold = gate();
    const agy = fill(limits("agy"), 20, hold.done);
    const deepseek = fill(limits("deepseek"), 20, hold.done);
    await tick();
    expect(agy.started.n).toBe(8);
    expect(agy.started.n + deepseek.started.n).toBe(10);
    hold.open();
    await Promise.all([...agy.jobs, ...deepseek.jobs]);
  });

  test("a cap below one and an unknown name get the run's limit", async () => {
    const limits = callLimits(config, 4);
    const hold = gate();
    const odd = fill(limits("odd"), 6, hold.done);
    const missing = fill(limits("missing"), 6, hold.done);
    await tick();
    expect(odd.started.n + missing.started.n).toBe(4);
    hold.open();
    await Promise.all([...odd.jobs, ...missing.jobs]);
  });

  test("a waiting job keeps its priority behind a provider's cap", async () => {
    const limit = callLimits({ ...config, providers: { agy: cli(1) } } as unknown as Config, 32)("agy");
    const busy = gate();
    const order: string[] = [];
    const jobs = [
      limit(() => busy.done),
      limit(async () => void order.push("quick")),
      limit(async () => void order.push("slow"), 0),
    ];
    busy.open();
    await Promise.all(jobs);
    expect(order).toEqual(["slow", "quick"]);
  });
});

describe("providerFor", () => {
  const jevProvider: Provider = { kind: "jev", model: "jev-1.13.0", args: [], timeoutSecs: 60 };
  const cfg = {
    defaultProvider: "deepseek",
    providers: { deepseek: net, agy: cli(8), jev: jevProvider },
  } as unknown as Config;
  const filler = { provider: "jev", scope: "paragraph" as const, jev: { keep: 0.5 } };
  const plain = { provider: null, scope: "paragraph" as const, jev: null };
  const order = { provider: "agy", scope: "document" as const, jev: null };
  const docJev = { provider: null, scope: "document" as const, jev: {} };

  test("without an override, a pass uses its own provider or the default", () => {
    expect(providerFor(cfg, filler)).toBe("jev");
    expect(providerFor(cfg, plain)).toBe("deepseek");
    expect(providerFor(cfg, order)).toBe("agy");
  });

  test("a jev override applies only to paragraph passes written for Jev", () => {
    expect(providerFor(cfg, { ...filler, provider: null }, "jev")).toBe("jev");
    expect(providerFor(cfg, plain, "jev")).toBe("deepseek");
    expect(providerFor(cfg, order, "jev")).toBe("agy");
    expect(providerFor(cfg, docJev, "jev")).toBe("deepseek");
  });

  test("any other override applies to every pass, the Jev passes included", () => {
    expect(providerFor(cfg, filler, "agy")).toBe("agy");
    expect(providerFor(cfg, plain, "agy")).toBe("agy");
    expect(providerFor(cfg, order, "deepseek")).toBe("deepseek");
  });
});
