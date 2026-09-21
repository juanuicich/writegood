/** A ceiling on work that may never finish.
 *
 *  The AI SDK takes a `timeout`, and it works by aborting the request. A fetch
 *  that ignores its abort signal leaves the promise pending for ever, and a
 *  pass then sits at `running` until the app quits, reporting nothing. This
 *  settles regardless of what the request decides to do. */
export function deadline<T>(work: Promise<T>, ms: number, who: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const expiry = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`${who} did not answer within ${Math.round(ms / 1000)}s`)),
      ms,
    );
  });
  // The request may well keep running; nothing here can stop it. What matters
  // is that the pass reports a failure and the run closes.
  return Promise.race([work, expiry]).finally(() => clearTimeout(timer)) as Promise<T>;
}
