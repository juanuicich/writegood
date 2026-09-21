/** Stand-ins for the Tauri plugins the app imports. */
export const fetch = globalThis.fetch.bind(globalThis);
export async function openPath(path: string) {
  console.log("openPath", path);
}
