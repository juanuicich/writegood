/** How the calls of one pass fail (SPEC §8.3, §8.4). Passes on a language
 *  model and passes on Jev count their failed calls here, so both follow one
 *  rule.
 *
 *  A call whose reply cannot be read, or that gets no reply, fails alone. Its
 *  answer is not saved, so the next run asks it again, and the pass goes on
 *  with its other calls. The pass fails when every call it made failed, when
 *  an answer cannot be saved, or when a call fails in a way that every other
 *  call would share: a bad config, a missing key or model, a refused key. */

/** A reply that came back and could not be read. */
export class Unreadable extends Error {}

/** A model call that got no reply, as Rust reports it (`CallError` in
 *  error.rs). `wholePass` marks a failure every call of the pass would
 *  share. */
export class CallError extends Error {
  constructor(
    message: string,
    readonly wholePass: boolean,
  ) {
    super(message);
  }

  /** The error a rejected `llm_chat` or `cli_run` gives. Anything else, such
   *  as a plain string, fails only its call. */
  static from(e: unknown): CallError {
    if (typeof e === "object" && e !== null && "message" in e) {
      const { message, wholePass } = e as { message: unknown; wholePass?: unknown };
      return new CallError(String(message), wholePass === true);
    }
    return new CallError(String(e), false);
  }
}

const messageOf = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** The failed calls of one pass. */
export class Failures {
  /** Calls whose reply could not be read. */
  unreadable = 0;
  /** Calls that got no reply. */
  unanswered = 0;
  /** Why the pass failed, or null. */
  failure: string | null = null;
  private first: string | null = null;

  /** `note` receives the message of each call that failed alone. */
  constructor(private readonly note: (message: string) => void = () => {}) {}

  /** The pass has failed, so it starts no more calls. */
  get stopped(): boolean {
    return this.failure !== null;
  }

  /** A call failed. It fails alone unless every call would fail the same
   *  way. */
  call(e: unknown): void {
    const message = messageOf(e);
    if (e instanceof CallError && e.wholePass) {
      this.failure ??= message;
      return;
    }
    if (e instanceof Unreadable) this.unreadable += 1;
    else this.unanswered += 1;
    this.first ??= message;
    this.note(message);
  }

  /** The pass failed for a reason no single call owns, such as an answer
   *  that could not be saved. */
  fail(e: unknown): void {
    this.failure ??= messageOf(e);
  }

  /** Call once every call has ended, with the number of calls asked. The
   *  pass fails when each of them failed. Returns why it failed, or null. */
  settle(asked: number): string | null {
    if (asked > 0 && this.unreadable + this.unanswered >= asked) this.failure ??= this.first;
    return this.failure;
  }
}
