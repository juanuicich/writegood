import { defineConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { fileURLToPath } from "node:url";

/** The app in an ordinary browser, with Tauri replaced by fixtures.
 *  `bun run browser`, then open http://localhost:1421 (add ?theme=dark). */
const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  root: fileURLToPath(new URL("../..", import.meta.url)),
  plugins: [svelte()],
  server: { port: 1421, strictPort: true },
  resolve: {
    alias: {
      "@tauri-apps/api/core": here("./mock-core.ts"),
      "@tauri-apps/plugin-opener": here("./mock-plugins.ts"),
    },
  },
});
