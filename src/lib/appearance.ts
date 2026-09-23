/** Text size steps for ⌘+ and ⌘-, and the base size ⌘0 returns to
 *  (SPEC §12.1). */

export const BASE_SIZE = 16;
export const MIN_SIZE = 12;
export const MAX_SIZE = 32;

/** The next size, 1px at a time, kept between MIN_SIZE and MAX_SIZE. A size
 *  already outside the range, set by hand in config.toml, moves into it. */
export function nextSize(current: number, step: 1 | -1): number {
  const next = Math.round(current) + step;
  return Math.min(MAX_SIZE, Math.max(MIN_SIZE, next));
}

/** The theme a toggle moves to. "system" resolves to what the system shows
 *  now, so the toggle always changes what is on screen. */
export function otherTheme(
  current: "light" | "dark" | "system",
  systemDark: boolean,
): "light" | "dark" {
  const shown = current === "system" ? (systemDark ? "dark" : "light") : current;
  return shown === "dark" ? "light" : "dark";
}
