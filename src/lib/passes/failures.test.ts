import { describe, expect, test } from "bun:test";
import { CallError, Failures, Unreadable } from "./failures";

describe("Failures", () => {
  test("a call with no reply fails alone and is counted", () => {
    const notes: string[] = [];
    const f = new Failures((m) => notes.push(m));
    f.call(new CallError("fake-model: HTTP 503", false));
    expect(f.unanswered).toBe(1);
    expect(f.unreadable).toBe(0);
    expect(f.stopped).toBe(false);
    expect(f.settle(3)).toBeNull();
    expect(notes).toEqual(["fake-model: HTTP 503"]);
  });

  test("a timeout or any other error is a call with no reply", () => {
    const f = new Failures();
    f.call(new Error("fake-model did not answer within 60s"));
    f.call("a string");
    expect(f.unanswered).toBe(2);
    expect(f.settle(3)).toBeNull();
  });

  test("an unreadable reply is counted apart", () => {
    const f = new Failures();
    f.call(new Unreadable("fake-model returned no JSON array"));
    expect(f.unreadable).toBe(1);
    expect(f.unanswered).toBe(0);
    expect(f.settle(2)).toBeNull();
  });

  test("the pass fails when every call failed, by either rule", () => {
    const f = new Failures();
    f.call(new Unreadable("no JSON array"));
    f.call(new CallError("HTTP 503", false));
    expect(f.settle(2)).toBe("no JSON array");
  });

  test("a pass that asked nothing does not fail", () => {
    expect(new Failures().settle(0)).toBeNull();
  });

  test("a failure every call would share stops the pass at once", () => {
    const notes: string[] = [];
    const f = new Failures((m) => notes.push(m));
    f.call(new CallError("fake-model: HTTP 401", true));
    expect(f.stopped).toBe(true);
    expect(f.failure).toBe("fake-model: HTTP 401");
    // It is the pass's failure, not a call asked again next run.
    expect(f.unanswered).toBe(0);
    expect(notes).toEqual([]);
    expect(f.settle(10)).toBe("fake-model: HTTP 401");
  });

  test("an answer that cannot be saved fails the pass", () => {
    const f = new Failures();
    f.fail(new Error("database: locked"));
    expect(f.stopped).toBe(true);
    expect(f.settle(5)).toBe("database: locked");
  });

  test("the first reason wins", () => {
    const f = new Failures();
    f.fail(new Error("first"));
    f.call(new CallError("second", true));
    expect(f.failure).toBe("first");
  });
});

describe("CallError.from", () => {
  test("reads the error Rust sends", () => {
    const e = CallError.from({ message: "no key for this provider", wholePass: true });
    expect(e).toBeInstanceOf(CallError);
    expect(e.message).toBe("no key for this provider");
    expect(e.wholePass).toBe(true);
  });

  test("anything else fails only its call", () => {
    const e = CallError.from("invalid args");
    expect(e.message).toBe("invalid args");
    expect(e.wholePass).toBe(false);
    expect(CallError.from({ message: "HTTP 503" }).wholePass).toBe(false);
  });
});
