import { describe, expect, test } from "bun:test";
import { isMod, localiseMarkdown, platformOf, shortcut, specOf } from "./shortcuts";

describe("shortcut", () => {
  test("macOS uses symbols in the spec's order", () => {
    expect(shortcut("Mod-k", "mac")).toBe("⌘K");
    expect(shortcut("Mod-Shift-r", "mac")).toBe("⌘⇧R");
    expect(shortcut("Alt-Mod-f", "mac")).toBe("⌥⌘F");
    expect(shortcut("Ctrl-Meta-s", "mac")).toBe("⌃⌘S");
    expect(shortcut("Mod-Enter", "mac")).toBe("⌘⏎");
    expect(shortcut("Alt-ArrowDown", "mac")).toBe("⌥↓");
    expect(shortcut("Mod--", "mac")).toBe("⌘-");
    expect(shortcut("Mod-+", "mac")).toBe("⌘+");
    expect(shortcut("Mod-?", "mac")).toBe("⌘?");
  });

  test("Linux uses Ctrl words in the usual order", () => {
    expect(shortcut("Mod-k", "linux")).toBe("Ctrl+K");
    expect(shortcut("Mod-Shift-r", "linux")).toBe("Ctrl+Shift+R");
    expect(shortcut("Alt-Mod-f", "linux")).toBe("Ctrl+Alt+F");
    expect(shortcut("Ctrl-Meta-s", "linux")).toBe("Ctrl+Super+S");
    expect(shortcut("Mod-Enter", "linux")).toBe("Ctrl+Enter");
    expect(shortcut("Alt-ArrowDown", "linux")).toBe("Alt+↓");
    expect(shortcut("Mod--", "linux")).toBe("Ctrl+Minus");
    expect(shortcut("Mod-+", "linux")).toBe("Ctrl+Plus");
  });

  test("Windows names the Windows key", () => {
    expect(shortcut("Mod-Shift-g", "windows")).toBe("Ctrl+Shift+G");
    expect(shortcut("Ctrl-Meta-s", "windows")).toBe("Ctrl+Win+S");
  });

  test("a bare key stays as typed", () => {
    for (const os of ["mac", "linux", "windows"] as const) {
      expect(shortcut("d", os)).toBe("d");
      expect(shortcut("Escape", os)).toBe("Esc");
    }
  });
});

describe("isMod", () => {
  test("is ⌘ on macOS and Ctrl elsewhere", () => {
    expect(isMod({ metaKey: true, ctrlKey: false }, "mac")).toBe(true);
    expect(isMod({ metaKey: false, ctrlKey: true }, "mac")).toBe(false);
    expect(isMod({ metaKey: false, ctrlKey: true }, "linux")).toBe(true);
    expect(isMod({ metaKey: true, ctrlKey: false }, "windows")).toBe(false);
  });
});

describe("platformOf", () => {
  test("reads the navigator's platform", () => {
    expect(platformOf("MacIntel")).toBe("mac");
    expect(platformOf("macOS")).toBe("mac");
    expect(platformOf("Win32")).toBe("windows");
    expect(platformOf("Linux x86_64")).toBe("linux");
    expect(platformOf("")).toBe("linux");
  });
});

describe("specOf", () => {
  test("reads a macOS label back", () => {
    expect(specOf("⌥⌘F")).toBe("Alt-Mod-f");
    expect(specOf("⌃⌘S")).toBe("Ctrl-Meta-s");
    expect(specOf("⇧Enter")).toBe("Shift-Enter");
    expect(specOf("⌘-")).toBe("Mod--");
    expect(specOf("r")).toBeNull();
    expect(specOf("~/.writegood")).toBeNull();
  });
});

describe("localiseMarkdown", () => {
  const md = "`⌘S` saves. `⌥⌘F` replaces. `⌘-` shrinks. Press `r` in `~/.writegood`.";

  test("leaves macOS text alone", () => {
    expect(localiseMarkdown(md, "mac")).toBe(md);
  });

  test("rewrites the shortcuts in code spans for Linux", () => {
    expect(localiseMarkdown(md, "linux")).toBe(
      "`Ctrl+S` saves. `Ctrl+Alt+F` replaces. `Ctrl+Minus` shrinks. Press `r` in `~/.writegood`.",
    );
  });
});
