/** A bound on how many model calls run at once (SPEC §8.3).
 *
 *  Every pass and every paragraph shares one limiter, so a run keeps the
 *  same number of calls in flight whether it holds one pass or nine. Jobs
 *  wait in priority order, lowest first, and in the order they were queued
 *  within one priority. A pass that thinks queues at priority 0, so its slow
 *  calls start before the quick ones. */
export type Limit = <T>(job: () => Promise<T>, priority?: number) => Promise<T>;

export function limiter(max: number): Limit {
  let running = 0;
  const waiting: { priority: number; start: () => void }[] = [];

  // A finished job hands its slot straight to the next one, so `running`
  // does not change between one job ending and the next starting.
  const release = () => {
    const next = waiting.shift();
    if (next) next.start();
    else running -= 1;
  };

  return async <T>(job: () => Promise<T>, priority = 1): Promise<T> => {
    if (running >= max) {
      await new Promise<void>((start) => {
        const at = waiting.findIndex((w) => w.priority > priority);
        waiting.splice(at < 0 ? waiting.length : at, 0, { priority, start });
      });
    } else {
      running += 1;
    }
    try {
      return await job();
    } finally {
      release();
    }
  };
}

/** A limiter for each provider, under one limiter for the whole run (SPEC
 *  §8.3). A provider's calls are bounded by its own cap, and all calls
 *  together by `bound`. A job first waits for a slot of its provider, then
 *  for a slot of the run, so a job held back by its provider's cap does not
 *  hold a run slot. Both queues keep the job's priority.
 *
 *  `capOf` gives a provider's cap. A missing cap, one below 1, or one at or
 *  above `bound` leaves the provider to the run's limiter alone. */
export function pooled(bound: number, capOf: (name: string) => number | null | undefined): (name: string) => Limit {
  const run = limiter(bound);
  const own = new Map<string, Limit>();
  return (name) => {
    const known = own.get(name);
    if (known) return known;
    const cap = capOf(name);
    let lim: Limit = run;
    if (cap != null && cap >= 1 && cap < bound) {
      const provider = limiter(Math.floor(cap));
      lim = <T>(job: () => Promise<T>, priority?: number) => provider(() => run(job, priority), priority);
    }
    own.set(name, lim);
    return lim;
  };
}
