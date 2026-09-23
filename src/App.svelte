<script lang="ts">
  import { onMount } from "svelte";
  import { app } from "./lib/state.svelte";
  import Editor from "./lib/editor/Editor.svelte";
  import Sidebar from "./lib/sidebar/Sidebar.svelte";
  import Palette, { type Command } from "./lib/palette/Palette.svelte";
  import Duel from "./lib/duel/Duel.svelte";
  import History from "./lib/history/History.svelte";
  import { runPasses, summarise } from "./lib/passes/run";
  import { cfg, log, shell, store } from "./lib/ipc";
  import { label } from "./lib/usage";
  import { nextSize } from "./lib/appearance";

  let booted = $state(false);
  let override = $state<string | null>(null);
  let palette = $state<Palette | null>(null);

  onMount(async () => {
    void log.write("info", "boot: starting");
    try {
      await app.boot();
      void log.write(
        "info",
        `boot: ${app.passes.length} pass(es), ${app.docs.length} document(s), ` +
          `open ${app.doc?.title ?? "none"}`,
      );
    } catch (e) {
      void log.write("error", `boot failed: ${String(e)}`);
      app.say(String(e));
    }
    booted = true;

    // A development hook. GUI automation needs accessibility permission that a
    // terminal does not have, so this is the only way to exercise the whole
    // in-app path — including Tauri's HTTP plugin — without a human at the
    // keyboard. VITE_WRITEGOOD_AUTORUN names a pass slug, or "all".
    const auto = import.meta.env.VITE_WRITEGOOD_AUTORUN;
    if (auto) {
      void log.write("info", `autorun: ${auto}`);
      await run(auto === "all" ? undefined : auto);
      void log.write("info", "autorun: returned");
    }

    // Design review: open the app already showing the state being reviewed.
    const show = new URLSearchParams(location.search).get("show");
    if (show === "review") {
      app.mode = "review";
      app.step(1);
    } else if (show === "history") {
      await app.openHistory();
    } else if (show === "duel") {
      app.openDuel();
    } else if (show === "palette") {
      app.paletteOpen = true;
    }
  });

  /** The open file's spending, when the config asks for it (SPEC §9.4). */
  const spent = $derived(
    app.config?.appearance.showCost && app.usage ? label(app.usage) : null,
  );

  /** Name what the runner is waiting for. Four passes run at once, so the
   *  active ones are listed and the rest are counted. */
  function running(p: { done: number; total: number; active: string[] }): string {
    const count = p.total > 1 ? ` · ${p.done} of ${p.total}` : "";
    if (p.active.length === 0) {
      return p.done === 0 ? `starting${count}` : `reading the replies${count}`;
    }
    return `asking about ${p.active.join(", ")}${count}`;
  }

  async function run(only?: string) {
    const passes = app.passes.filter(
      (p) => p.enabled && (only === undefined || p.slug === only),
    );
    if (passes.length === 0) return app.say("no passes enabled");
    // Claim the status line before the first await, or it reads "working"
    // until the runner gets going.
    app.progress = { done: 0, total: passes.length, active: [] };
    await app.withBusy(`running ${passes.length} pass${passes.length === 1 ? "" : "es"}…`, async () => {
      try {
        app.say(summarise(await runPasses(passes, { override })));
      } catch (e) {
        app.say(e instanceof Error ? e.message : String(e));
      } finally {
        app.progress = null;
      }
    });
  }

  /** ⌘+ and ⌘-: the whole window's text, saved so the next launch keeps it
   *  (SPEC §12.1). */
  async function resize(step: 1 | -1) {
    const config = app.config;
    if (!config) return;
    const size = nextSize(config.appearance.fontSize, step);
    if (size === config.appearance.fontSize) return;
    config.appearance.fontSize = size;
    app.applyAppearance();
    await cfg.save(config);
  }

  const commands: Command[] = [
    {
      id: "open",
      label: "open",
      hint: "⌘O",
      choices: () =>
        app.docs.map((d) => ({
          value: d.path,
          label: d.title,
          hint: `${d.words} words`,
        })),
      run: (path) => path && app.open(path),
    },
    {
      id: "new",
      label: "new document",
      argument: "title",
      run: (title) => app.create(title ?? "Untitled"),
    },
    { id: "run", label: "run all passes", hint: "⌘R", run: () => run() },
    {
      id: "run-one",
      label: "run one pass",
      hint: "⌘⇧R",
      choices: () =>
        app.passes.map((p) => ({ value: p.slug, label: p.name, hint: p.scope })),
      run: (slug) => run(slug),
    },
    { id: "save", label: "save", hint: "⌘S", run: () => app.save(false) },
    {
      id: "history",
      label: "revisions",
      hint: "⌘Y",
      run: () => app.openHistory(),
    },
    {
      id: "duel",
      label: "compare a rewrite of this paragraph",
      hint: "⌘D",
      run: () => app.openDuel(),
    },
    {
      id: "major",
      label: "flag a major revision",
      argument: "what changed",
      run: (label) => app.save(true, label || "major revision"),
    },
    {
      id: "provider",
      label: "use provider for this session",
      choices: () => [
        { value: "", label: "as configured", hint: app.config?.defaultProvider },
        ...Object.entries(app.config?.providers ?? {}).map(([name, p]) => ({
          value: name,
          label: name,
          hint: p.model ?? p.kind,
        })),
      ],
      run: (name) => {
        override = name || null;
        app.say(override ? `provider: ${override}` : "provider: as configured");
      },
    },
    {
      id: "clear",
      label: "clear findings",
      run: async () => {
        if (!app.doc) return;
        await store.clearFindings(app.doc.id);
        await app.loadFindings();
        app.say("findings cleared");
      },
    },
    {
      id: "reload",
      label: "reload passes and config",
      run: async () => {
        app.config = await cfg.load();
        app.passes = await cfg.passes();
        app.applyAppearance();
        app.say(`${app.passes.length} passes`);
      },
    },
    {
      id: "theme",
      label: "theme",
      choices: () => [
        { value: "light", label: "light" },
        { value: "dark", label: "dark" },
        { value: "system", label: "system" },
      ],
      run: async (theme) => {
        if (!app.config || !theme) return;
        app.config.appearance.theme = theme as "light" | "dark" | "system";
        app.applyAppearance();
        await cfg.save(app.config);
      },
    },
    { id: "bigger", label: "bigger text", hint: "⌘+", run: () => resize(1) },
    { id: "smaller", label: "smaller text", hint: "⌘-", run: () => resize(-1) },
    {
      id: "sidebar",
      label: "toggle the margin",
      run: () => (app.sidebarForced = !app.sidebarForced),
    },
    {
      id: "folder",
      label: "open the writegood folder",
      run: () => app.paths && shell.openPath(app.paths.home),
    },
    {
      id: "config",
      label: "edit config.toml",
      run: () => app.paths && shell.openPath(app.paths.config),
    },
    {
      id: "passes-folder",
      label: "edit the passes",
      run: () => app.paths && shell.openPath(app.paths.passes),
    },
  ];

  function keydown(e: KeyboardEvent) {
    const meta = e.metaKey || e.ctrlKey;

    if (meta && e.key === "k") {
      e.preventDefault();
      app.paletteOpen = !app.paletteOpen;
      return;
    }
    if (app.paletteOpen) return;
    // The sheets cover everything and handle their own keys.
    if (app.duel || app.history) return;

    // ⌘+ is ⌘⇧= on a US keyboard, so "=" counts as bigger too.
    if (meta && (e.key === "+" || e.key === "=")) {
      e.preventDefault();
      void resize(1);
      return;
    }
    if (meta && e.key === "-") {
      e.preventDefault();
      void resize(-1);
      return;
    }

    if (meta && e.key === "y") {
      e.preventDefault();
      void app.openHistory();
      return;
    }

    if (meta && e.key === "d") {
      e.preventDefault();
      app.openDuel();
      return;
    }

    if (meta && e.key === "o") {
      e.preventDefault();
      app.paletteOpen = true;
      return;
    }
    if (meta && e.key === "s") {
      e.preventDefault();
      void app.save(e.shiftKey, e.shiftKey ? "major revision" : undefined);
      return;
    }
    // ⌘R and ⌘⏎ both run the passes, with ⇧ to pick one. The menu shows the
    // R keys; ⌘⏎ is handled here (SPEC §12.4). ⇧ can turn e.key upper case.
    if (meta && (e.key === "Enter" || e.key.toLowerCase() === "r")) {
      e.preventDefault();
      if (e.shiftKey) void palette?.runCommand("run-one");
      else void run();
      return;
    }
    if (e.altKey && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
      e.preventDefault();
      app.step(e.key === "ArrowDown" ? 1 : -1);
      return;
    }

    if (e.key === "Escape") {
      e.preventDefault();
      if (app.mode === "write") {
        app.mode = "review";
        (document.activeElement as HTMLElement | null)?.blur();
        if (app.cursor < 0 && app.visible.length > 0) app.step(1);
      } else {
        app.mode = "write";
        app.editor?.commands.focus();
      }
      return;
    }

    // Single letters only in review mode, where they cannot become text.
    if (app.mode !== "review" || meta || e.altKey) return;
    switch (e.key) {
      case "n":
      case "j":
        e.preventDefault();
        app.step(1);
        break;
      case "p":
      case "k":
        e.preventDefault();
        app.step(-1);
        break;
      case "x":
        e.preventDefault();
        void app.mark("addressed");
        break;
      case "d":
        e.preventDefault();
        void app.mark("dismissed");
        break;
      case "r":
        e.preventDefault();
        app.toggleReveal();
        break;
      case "i":
      case "Enter":
        e.preventDefault();
        app.mode = "write";
        app.editor?.commands.focus();
        break;
    }
  }
</script>

<svelte:window onkeydown={keydown} />

<main class:reviewing={app.mode === "review"}>
  <div class="centre"><Editor /></div>
  {#if app.showSidebar}<Sidebar />{/if}
</main>

<footer>
  <span class="left">
    {#if app.mode === "review"}<span class="live">review</span>{/if}
    {#if spent}<span class="spent" title="spent on this file">{spent}</span>{/if}
  </span>
  <span class="right">
    {#if app.progress}<span class="live">{running(app.progress)}</span>
    {:else if app.busy > 0}<span class="live">working</span>{/if}
    {#if app.status}{app.status}{/if}
    {#if app.dirty}<span class="unsaved" title="unsaved">·</span>{/if}
  </span>
</footer>

<Duel />
<History />

{#if booted}<Palette {commands} bind:this={palette} />{/if}

<style>
  main {
    display: flex;
    height: 100%;
    align-items: stretch;
  }

  .centre {
    flex: 1 1 auto;
    min-width: 0;
  }

  /* Review mode dims the text a little so the margin reads as the active pane. */
  main.reviewing .centre {
    opacity: 0.72;
  }

  footer {
    position: fixed;
    left: 0;
    right: 0;
    bottom: 0;
    display: flex;
    justify-content: space-between;
    padding: 0.5rem 1.6rem;
    font-size: 0.66rem;
    font-variant-caps: all-small-caps;
    letter-spacing: 0.1em;
    color: var(--ink-faint);
    pointer-events: none;
  }

  .left { display: inline-flex; gap: 1.2em; }
  /* Standing information, not a change of state, so it keeps the faint ink. */
  .spent { font-variant-numeric: tabular-nums; }

  /* Two states worth a glance: something is happening, something is unsaved. */
  .live { color: var(--accent); }
  .unsaved { color: var(--accent); font-size: 1.4em; line-height: 0; }
</style>
