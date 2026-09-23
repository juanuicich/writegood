/** Keyboard shortcuts on each platform (SPEC §12.7).
 *
 *  A shortcut is written once, as a spec in ProseMirror's notation: "Mod-k",
 *  "Mod-Shift-r", "Alt-ArrowDown", "d". `Mod` is ⌘ on macOS and Ctrl on Linux
 *  and Windows. `Meta` is ⌘, the Windows key or Super, on every platform.
 *  Every label the app shows is made from a spec by `shortcut`, so the labels
 *  and the platform cannot disagree. */

export type Platform = "mac" | "windows" | "linux";

/** The platform the webview runs on. WebKit on macOS and Linux and WebView2
 *  on Windows all report it in `navigator.platform`. `?os=` overrides it, so
 *  the browser fixture can show another platform's labels. */
export function detect(): Platform {
  const query = typeof location === "undefined" ? null : new URLSearchParams(location.search).get("os");
  if (query === "mac" || query === "windows" || query === "linux") return query;
  if (typeof navigator === "undefined") return "mac";
  const nav = navigator as Navigator & { userAgentData?: { platform?: string } };
  return platformOf(nav.userAgentData?.platform || nav.platform || nav.userAgent);
}

/** Read a platform from a navigator string. Anything unknown is Linux. */
export function platformOf(name: string): Platform {
  const s = name.toLowerCase();
  if (s.includes("mac")) return "mac";
  if (s.includes("win")) return "windows";
  return "linux";
}

export const platform: Platform = detect();

/** True when the platform's primary modifier is held: ⌘ on macOS, Ctrl
 *  elsewhere. Ctrl on macOS stays free for the text field's own keys. */
export function isMod(e: Pick<KeyboardEvent, "metaKey" | "ctrlKey">, os: Platform = platform): boolean {
  return os === "mac" ? e.metaKey : e.ctrlKey;
}

const MAC_MODS: Record<string, string> = { Mod: "⌘", Meta: "⌘", Ctrl: "⌃", Alt: "⌥", Shift: "⇧" };
const MAC_KEYS: Record<string, string> = { Enter: "⏎", Escape: "Esc", ArrowDown: "↓", ArrowUp: "↑" };
const PC_KEYS: Record<string, string> = { Escape: "Esc", ArrowDown: "↓", ArrowUp: "↑", "+": "Plus", "-": "Minus" };

/** Linux and Windows name the modifiers in this order. */
const PC_ORDER = ["Ctrl", "Alt", "Shift", "Meta"];

/** The label for a spec. On macOS the modifiers are symbols, in the order the
 *  spec gives them: "⌘⇧R". Elsewhere they are words joined by "+", in the
 *  usual order: "Ctrl+Shift+R". A letter with a modifier is upper case; a
 *  bare letter stays as typed, because upper case would mean ⇧. */
export function shortcut(spec: string, os: Platform = platform): string {
  const { mods, key } = parse(spec);
  const shown = mods.length > 0 && key.length === 1 ? key.toUpperCase() : key;
  if (os === "mac") {
    return mods.map((m) => MAC_MODS[m] ?? m).join("") + (MAC_KEYS[shown] ?? shown);
  }
  const named = mods
    .map((m) => (m === "Mod" ? "Ctrl" : m))
    .sort((a, b) => PC_ORDER.indexOf(a) - PC_ORDER.indexOf(b))
    .map((m) => (m === "Meta" ? (os === "windows" ? "Win" : "Super") : m));
  return [...named, PC_KEYS[shown] ?? shown].join("+");
}

/** Split a spec into its modifiers and its key. The key can be "-" itself,
 *  as in "Mod--". */
function parse(spec: string): { mods: string[]; key: string } {
  if (spec.endsWith("-")) {
    return { mods: spec.slice(0, -1).split("-").filter(Boolean), key: "-" };
  }
  const parts = spec.split("-");
  return { mods: parts.slice(0, -1), key: parts[parts.length - 1]! };
}

const SYMBOLS: Record<string, string> = { "⌘": "Mod", "⌥": "Alt", "⇧": "Shift", "⌃": "Ctrl" };
const SYMBOL_KEYS: Record<string, string> = { "⏎": "Enter", "↓": "ArrowDown", "↑": "ArrowUp" };

/** Read a macOS label back into a spec: "⌥⌘F" is "Alt-Mod-f". With ⌃ in the
 *  label, ⌘ is `Meta`, because Mod would mean Ctrl twice elsewhere. Null
 *  when the text is not a shortcut. */
export function specOf(label: string): string | null {
  const chars = Array.from(label);
  const mods: string[] = [];
  while (chars.length > 0 && SYMBOLS[chars[0]!]) mods.push(SYMBOLS[chars.shift()!]!);
  const key = chars.join("");
  if (mods.length === 0 || key === "") return null;
  const named = mods.includes("Ctrl") ? mods.map((m) => (m === "Mod" ? "Meta" : m)) : mods;
  const k = SYMBOL_KEYS[key] ?? (key.length === 1 ? key.toLowerCase() : key);
  return [...named, k].join("-");
}

/** Rewrite the macOS shortcuts in a Markdown text's code spans for the
 *  platform. The help page is written with macOS labels. */
export function localiseMarkdown(md: string, os: Platform = platform): string {
  if (os === "mac") return md;
  return md.replace(/`([^`\n]+)`/g, (span, inner: string) => {
    const spec = specOf(inner);
    return spec ? `\`${shortcut(spec, os)}\`` : span;
  });
}
