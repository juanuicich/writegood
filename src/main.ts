import "./app.css";
import { mount } from "svelte";
import App from "./App.svelte";
import { log } from "./lib/ipc";

// A built app has no visible console. Anything that escapes to the top must
// still leave a trace, or a pass that dies takes its explanation with it.
window.addEventListener("error", (e) => {
  void log.write("error", `uncaught: ${e.message} (${e.filename}:${e.lineno})`);
});
window.addEventListener("unhandledrejection", (e) => {
  void log.write("error", `unhandled rejection: ${String(e.reason)}`);
});
document.addEventListener("visibilitychange", () => {
  void log.write("info", `window ${document.visibilityState}`);
});

void log.write("info", "frontend loaded");

export default mount(App, { target: document.getElementById("app")! });
