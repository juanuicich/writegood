import { isMod } from "../shortcuts";

/** ⌘? opens and closes the help. On a US keyboard it is ⌘⇧/, and with ⌘ held
 *  WebKit can report the key as "/" rather than "?". */
export function isHelpKey(e: Pick<KeyboardEvent, "key" | "metaKey" | "ctrlKey" | "shiftKey">): boolean {
  if (!isMod(e)) return false;
  return e.key === "?" || (e.shiftKey && e.key === "/");
}
