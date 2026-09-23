<script lang="ts">
  import { onMount, untrack } from "svelte";
  import { app } from "./lib/state.svelte";
  import Editor from "./lib/editor/Editor.svelte";
  import FindBar from "./lib/editor/FindBar.svelte";
  import Sidebar from "./lib/sidebar/Sidebar.svelte";
  import Palette, { type Command } from "./lib/palette/Palette.svelte";
  import Duel from "./lib/duel/Duel.svelte";
  import History from "./lib/history/History.svelte";
  import Help from "./lib/help/Help.svelte";
  import { isHelpKey } from "./lib/help/keys";
  import { runPasses, summarise } from "./lib/passes/run";
  import { uncheckedParagraphs } from "./lib/passes/unchecked";
  import { paragraphBlocks, setUnchecked } from "./lib/editor/unchecked";
  import { cfg, log, onMenuCommand, shell, store } from "./lib/ipc";
  import { label } from "./lib/usage";
  import { BASE_SIZE, nextSize, otherTheme } from "./lib/appearance";
  import { isMod, shortcut } from "./lib/shortcuts";
  import { hint } from "./lib/hints";

  let booted = $state(false);
  let override = $state<string | null>(null);
  let palette = $state<Palette | null>(null);

  onMount(async () => {
    void log.write("info", "boot: starting");
    try {
      await app.boot();
      void log.write(
        "info",
        `boot: ${app.passes.length} pass(es), ${app.recent.length} recent document(s), ` +
          `open ${app.doc?.title ?? "none"}`,
      );
    } catch (e) {
      void log.write("error", `boot failed: ${String(e)}`);
      app.say(String(e));
    }
    booted = true;

    // File > Open Recent emits open-doc:<id>, which is not a palette command.
    // Behind a sheet it does nothing, as other menu commands do.
    void onMenuCommand((id) => {
      if (!id.startsWith("open-doc:") || app.duel || app.history || app.help) return;
      void app.reopen(Number(id.slice("open-doc:".length))).catch((e) => app.say(String(e)));
    });

    // A development hook: run passes at launch, with no one at the keyboard.
    // It predates the WebDriver server (SPEC §16), which now drives the window
    // too. VITE_WRITEGOOD_AUTORUN names a pass slug, or "all".
    const auto = import.meta.env.VITE_WRITEGOOD_AUTORUN;
    if (auto) {
      void log.write("info", `autorun: ${auto}`);
      await run(auto === "all" ? undefined : auto);
      void log.write("info", "autorun: returned");
    }

    // Design review: open the app already showing the state being reviewed.
    const show = new URLSearchParams(location.search).get("show");
    if (show === "review") {
      app.enterReview();
      app.step(1);
    } else if (show === "history") {
      await app.openHistory();
    } else if (show === "duel") {
      app.openDuel();
    } else if (show === "find") {
      // After the editor's own autofocus, which puts the caret at the end.
      setTimeout(() => {
        app.findText = "the";
        app.replaceText = "a";
        app.openFind(true);
        app.findStep(1);
      }, 300);
    } else if (show === "palette") {
      app.paletteOpen = true;
    } else if (show === "help") {
      app.openHelp();
    }
  });

  /** The folder a recent file sits in, as a hint beside its title. */
  function folder(path: string | null): string {
    if (!path) return "untitled";
    const parts = path.split("/");
    return parts.length > 1 ? parts[parts.length - 2] : "";
  }

  /** The open file's spending, when the config asks for it (SPEC §9.4). */
  const spent = $derived(
    app.config?.appearance.showCost && app.usage ? label(app.usage) : null,
  );

  /** The next step of the hints, when its action can work now (SPEC §12.7). */
  const tip = $derived(
    booted
      ? hint(app.actions, {
          doc: app.doc !== null,
          findings: app.visible.length > 0,
          focused: app.current !== null,
          mode: app.mode,
        })
      : null,
  );

  // Opening the command bar by any route counts: the key, or a menu item
  // that opens it on a command.
  $effect(() => {
    if (app.paletteOpen) untrack(() => app.did("palette"));
  });

  /** Name what the runner is waiting for. Four passes run at once, so the
   *  active ones are listed and the rest are counted. */
  function running(p: { done: number; total: number; active: string[] }): string {
    const count = p.total > 1 ? ` · ${p.done} of ${p.total}` : "";
    if (p.active.length === 0) {
      return p.done === 0 ? `starting${count}` : `reading the replies${count}`;
    }
    return `asking about ${p.active.join(", ")}${count}`;
  }

  /** Run the enabled passes, or one. `fresh` ignores the saved answers and
   *  asks every question again (SPEC §8.3). */
  async function run(only?: string, fresh = false) {
    app.did("run");
    const passes = app.passes.filter(
      (p) => p.enabled && (only === undefined || p.slug === only),
    );
    if (passes.length === 0) return app.say("no passes enabled");
    // Claim the status line before the first await, or it reads "working"
    // until the runner gets going.
    app.progress = { done: 0, total: passes.length, active: [] };
    await app.withBusy(`running ${passes.length} pass${passes.length === 1 ? "" : "es"}…`, async () => {
      try {
        app.say(summarise(await runPasses(passes, { override, fresh })));
      } catch (e) {
        app.say(e instanceof Error ? e.message : String(e));
      } finally {
        app.progress = null;
      }
    });
    if (app.mode === "review") void markUnchecked(false);
  }

  /** Bumped on every call of markUnchecked, so a slower, older call cannot
   *  draw over a newer one. */
  let marking = 0;

  /** Review mode marks the paragraphs that are not checked (SPEC §12.4).
   *  Outside review mode, and before any pass has run, there are no
   *  markers. `entering` says whether review mode has just started; only
   *  then does the status line say that no pass has run. */
  async function markUnchecked(entering: boolean) {
    const seq = ++marking;
    const editor = app.editor;
    if (!editor) return;
    if (app.mode !== "review" || !app.doc) return setUnchecked(editor, []);
    const doc = editor.state.doc;
    const index = app.index();
    try {
      const found = await uncheckedParagraphs(app.passes, override, index.text);
      // The keys were computed for this text in this mode. If either has
      // changed since, the result is stale.
      if (seq !== marking || app.mode !== "review" || app.editor !== editor || editor.state.doc !== doc) return;
      if (found === null && entering) app.say("no passes run yet");
      const blocks = paragraphBlocks(doc, index);
      setUnchecked(editor, (found ?? []).map((i) => blocks[i]!));
    } catch (e) {
      void log.write("error", `unchecked paragraphs: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  // Entering review mode draws the markers; leaving it removes them.
  $effect(() => {
    const mode = app.mode;
    untrack(() => void markUnchecked(mode === "review"));
  });

  /** ⌘+ and ⌘-: the whole window's text, and ⌘0 back to the base size, saved so the next launch keeps it
   *  (SPEC §12.1). */
  async function resize(step: 1 | -1 | 0) {
    const config = app.config;
    if (!config) return;
    const size = step === 0 ? BASE_SIZE : nextSize(config.appearance.fontSize, step);
    if (size === config.appearance.fontSize) return;
    config.appearance.fontSize = size;
    app.applyAppearance();
    await cfg.save(config);
  }

  /** Set the theme and save it, so the next launch keeps it. */
  async function setTheme(theme: "light" | "dark" | "system") {
    const config = app.config;
    if (!config) return;
    config.appearance.theme = theme;
    app.applyAppearance();
    await cfg.save(config);
  }

  const commands: Command[] = [
    { id: "open", label: "open…", hint: shortcut("Mod-o"), run: () => app.openDialog() },
    {
      id: "open-recent",
      label: "open recent",
      choices: () =>
        app.recent.map((d) => ({
          value: String(d.id),
          label: d.title,
          hint: folder(d.path),
        })),
      run: (id) => id && app.reopen(Number(id)),
    },
    { id: "new", label: "new document", hint: shortcut("Mod-n"), run: () => app.create() },
    { id: "run", label: "run all passes", hint: shortcut("Mod-r"), run: () => run() },
    { id: "run-fresh", label: "run all passes afresh", run: () => run(undefined, true) },
    {
      id: "run-one",
      label: "run one pass",
      hint: shortcut("Mod-Shift-r"),
      choices: () =>
        app.passes.map((p) => ({ value: p.slug, label: p.name, hint: p.scope })),
      run: (slug) => run(slug),
    },
    { id: "find", label: "find", hint: shortcut("Mod-f"), run: () => app.openFind(false) },
    { id: "replace", label: "find and replace", hint: shortcut("Alt-Mod-f"), run: () => app.openFind(true) },
    { id: "find-next", label: "find next", hint: shortcut("Mod-g"), run: () => app.findStep(1) },
    { id: "find-prev", label: "find previous", hint: shortcut("Mod-Shift-g"), run: () => app.findStep(-1) },
    { id: "replace-all", label: "replace all", hint: shortcut("Alt-Enter"), run: () => app.replaceAll() },
    { id: "save", label: "save", hint: shortcut("Mod-s"), run: () => app.saveNow() },
    { id: "save-as", label: "save as…", hint: shortcut("Mod-Shift-s"), run: () => app.saveAs() },
    {
      id: "history",
      label: "revisions",
      hint: shortcut("Mod-y"),
      run: () => app.openHistory(),
    },
    {
      id: "duel",
      label: "paragraph duel",
      hint: shortcut("Mod-d"),
      run: () => app.openDuel(),
    },
    {
      id: "major",
      label: "flag a major revision",
      hint: shortcut("Mod-Alt-s"),
      argument: "what changed",
      run: (label) => app.saveMajor(label || "major revision"),
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
        // A jev override reaches only the passes written for Jev (SPEC §9.1).
        const jev = override !== null && app.config?.providers[override]?.kind === "jev";
        app.say(
          override === null
            ? "provider: as configured"
            : jev
              ? `provider: ${override}, for the passes written for Jev`
              : `provider: ${override}`,
        );
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
      run: (theme) => theme && setTheme(theme as "light" | "dark" | "system"),
    },
    {
      id: "toggle-theme",
      label: "switch light and dark",
      run: () => {
        const current = app.config?.appearance.theme ?? "light";
        const systemDark = matchMedia("(prefers-color-scheme: dark)").matches;
        return setTheme(otherTheme(current, systemDark));
      },
    },
    { id: "bigger", label: "bigger text", hint: shortcut("Mod-+"), run: () => resize(1) },
    { id: "smaller", label: "smaller text", hint: shortcut("Mod--"), run: () => resize(-1) },
    { id: "actual-size", label: "actual size", hint: shortcut("Mod-0"), run: () => resize(0) },
    {
      id: "sidebar",
      label: "show or hide the margin",
      hint: shortcut("Ctrl-Meta-s"),
      run: () => app.toggleMargin(),
    },
    { id: "help", label: "help", hint: shortcut("Mod-?"), run: () => app.openHelp() },
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
    const meta = isMod(e);

    if (meta && e.key === "k") {
      e.preventDefault();
      app.paletteOpen = !app.paletteOpen;
      return;
    }
    if (app.paletteOpen) return;
    // ⌘+ is ⌘⇧= on a US keyboard, so "=" counts as bigger too. Text size
    // applies over the sheets as well, so it comes before they take the keys.
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
    if (meta && e.key === "0") {
      e.preventDefault();
      void resize(0);
      return;
    }

    // The sheets cover everything and handle their own keys.
    if (app.duel || app.history || app.help) return;

    if (isHelpKey(e)) {
      e.preventDefault();
      app.openHelp();
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

    // ⌘N, ⌘O and the three save keys run the same palette command as the
    // menu item (SPEC §6.3). ⇧ can turn e.key upper case, and ⌥ turns S
    // into ß on a Mac, so S is matched by its physical key.
    if (meta && e.key === "n") {
      e.preventDefault();
      void palette?.runCommand("new");
      return;
    }
    if (meta && e.key === "o") {
      e.preventDefault();
      void palette?.runCommand("open");
      return;
    }
    // ⌃⌘S shows or hides the margin (SPEC §12.1). It has to come before the
    // save keys, which Ctrl alone triggers off macOS.
    if (e.metaKey && e.ctrlKey && e.code === "KeyS") {
      e.preventDefault();
      void palette?.runCommand("sidebar");
      return;
    }
    if (meta && e.code === "KeyS") {
      e.preventDefault();
      const id = e.altKey ? "major" : e.shiftKey ? "save-as" : "save";
      void palette?.runCommand(id);
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
    // Find (SPEC §12.6). ⌥ and ⇧ change e.key, so the letters are matched by
    // their physical keys.
    if (meta && e.code === "KeyF") {
      e.preventDefault();
      app.openFind(e.altKey);
      return;
    }
    if (meta && e.code === "KeyG") {
      e.preventDefault();
      app.findStep(e.shiftKey ? -1 : 1);
      return;
    }
    if (e.altKey && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
      e.preventDefault();
      app.step(e.key === "ArrowDown" ? 1 : -1);
      return;
    }

    if (e.key === "Escape") {
      e.preventDefault();
      if (app.mode === "write") app.escape();
      else app.leaveReview();
      return;
    }

    // Single letters only in review mode, where they cannot become text.
    if (app.mode !== "review" || meta || e.altKey) return;
    switch (e.key) {
      case "n":
      case "j":
        e.preventDefault();
        app.did("move");
        app.step(1);
        break;
      case "p":
      case "k":
        e.preventDefault();
        app.did("move");
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
        app.leaveReview();
        break;
    }
  }
</script>

<svelte:window onkeydown={keydown} />

<main class:reviewing={app.mode === "review"}>
  <div class="centre"><Editor /><FindBar /></div>
  {#if app.showSidebar}<Sidebar />{/if}
</main>

<footer>
  <span class="left">
    {#if app.mode === "review"}<span class="live">review</span>{/if}
    {#if spent}<span class="spent" title="spent on this file">{spent}</span>{/if}
    {#if tip}<span class="hint">{tip}</span>{/if}
  </span>
  <span class="right">
    {#if app.progress}<span class="live">{running(app.progress)}</span>
    {:else if app.busy > 0}<span class="live">working</span>{/if}
    {#if app.status}{app.status}{/if}
    {#if app.dirty || app.untitled}<span class="unsaved" title="unsaved">·</span>{/if}
  </span>
</footer>

<Duel />
<History />
<Help />

{#if booted}<Palette {commands} bind:this={palette} />{/if}

<style>
  main {
    display: flex;
    height: 100%;
    align-items: stretch;
  }

  .centre {
    position: relative;
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
  /* A sentence, so it keeps its case; the key symbols read badly in small caps. */
  .hint { font-variant-caps: normal; letter-spacing: 0; font-size: 1.1em; }

  /* Two states worth a glance: something is happening, something is unsaved. */
  .live { color: var(--accent); }
  .unsaved { color: var(--tertiary); font-size: 1.4em; line-height: 0; }
</style>
