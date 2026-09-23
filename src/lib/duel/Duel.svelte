<script lang="ts">
  import { app } from "../state.svelte";
  import { runDuel, describe, judgeName } from "./run";
  import { onMenuCommand, store } from "../ipc";
  import { tally } from "./judge";

  let field = $state<HTMLTextAreaElement | null>(null);
  let record = $state({ total: 0, original: 0, rewrite: 0, ties: 0 });

  $effect(() => {
    if (app.duel) queueMicrotask(() => field?.focus());
  });

  $effect(() => {
    const doc = app.doc;
    if (!doc) return;
    void store.duels(doc.id).then((rows) => (record = tally(rows)));
  });

  async function submit() {
    const d = app.duel;
    if (!d || !app.config || !app.doc || d.busy) return;
    const docId = app.doc.id;
    d.busy = true;
    d.error = "";
    try {
      const outcome = await runDuel(
        app.config,
        docId,
        d.original,
        d.rewrite,
        d.findingId,
      );
      // The judge was paid whether or not the duel is still on screen.
      void app.loadUsage();
      // Esc during the call abandons the duel. The reply arrives anyway, so
      // check that this is still the duel on screen before showing it.
      if (app.duel !== d) return;
      d.result = outcome;
      app.say(describe(outcome));
      record = tally(await store.duels(docId));
    } catch (e) {
      if (app.duel === d) d.error = e instanceof Error ? e.message : String(e);
    } finally {
      d.busy = false;
    }
  }

  // If macOS hands ⌘R to the menu before the page, it arrives as the menu's
  // "run" command. While the duel is open that means ask the judge; the
  // palette ignores menu commands behind a sheet (SPEC §12.4).
  $effect(() => {
    let stop: (() => void) | null = null;
    let done = false;
    void onMenuCommand((id) => {
      if (id === "run" && app.duel) void submit();
    }).then((off) => {
      if (done) off();
      else stop = off;
    });
    return () => {
      done = true;
      stop?.();
    };
  });

  /** The sheet is a plain div, so it cannot take key events itself. Listen on
   *  the window while the duel is open, the way the revision sheet does. */
  function keydown(e: KeyboardEvent) {
    if (e.key === "Escape") {
      e.preventDefault();
      app.closeDuel();
    } else if ((e.key === "Enter" || e.key.toLowerCase() === "r") && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      void submit();
    }
  }
</script>

<svelte:window onkeydown={app.duel ? keydown : undefined} />

{#if app.duel}
  <div class="sheet">
    <div class="inner">
      <p class="label">as it stands</p>
      <p class="original">{app.duel.original}</p>

      <p class="label">your rewrite</p>
      <textarea
        bind:this={field}
        bind:value={app.duel.rewrite}
        rows="6"
        spellcheck="false"
        placeholder="Write it again."
        disabled={app.duel.busy || !!app.duel.result}
      ></textarea>

      {#if app.duel.result}
        {@const r = app.duel.result}
        <p class="verdict">
          {r.originalWon === null
            ? "A tie."
            : r.originalWon
              ? "Your first version won."
              : "Your rewrite won."}
        </p>
        <p class="reason">{r.verdict.reason}</p>
        {#if r.warning}<p class="warn">{r.warning}</p>{/if}
      {:else if app.duel.error}
        <p class="warn">{app.duel.error}</p>
      {/if}

      <p class="foot">
        {#if app.duel.busy}
          asking {judgeName(app.config!)}…
        {:else if app.duel.result}
          esc to close
        {:else}
          ⌘R to ask {judgeName(app.config!)} · esc to abandon
        {/if}
        {#if record.total > 0}
          <span class="record"
            >{record.rewrite} rewrites, {record.original} first drafts, {record.ties} ties</span
          >
        {/if}
      </p>
    </div>
  </div>
{/if}

<style>
  .sheet {
    position: fixed;
    inset: 0;
    background: var(--paper);
    overflow-y: auto;
    padding: 12vh 0 20vh;
  }

  .inner {
    max-width: calc(var(--measure) + 6rem);
    margin: 0 auto;
    padding: 0 3rem;
  }

  .label {
    font-size: 0.66rem;
    font-variant-caps: all-small-caps;
    letter-spacing: 0.1em;
    color: var(--ink-faint);
    margin: 0 0 0.5rem;
  }

  .original {
    margin: 0 0 2.4rem;
    color: var(--ink-soft);
  }

  textarea {
    font: inherit;
    color: inherit;
    width: 100%;
    background: none;
    border: 0;
    border-left: 1px solid var(--rule);
    padding: 0 0 0 1.4rem;
    margin: 0 0 2.4rem;
    outline: none;
    resize: none;
    line-height: var(--lead);
  }
  textarea::placeholder { color: var(--ink-faint); }
  textarea:disabled { color: var(--ink-soft); }

  .verdict { margin: 0 0 0.4rem; color: var(--accent); }
  .reason { margin: 0 0 1.6rem; color: var(--ink-soft); }
  .warn { margin: 0 0 1.6rem; color: var(--ink-soft); }

  .foot {
    display: flex;
    justify-content: space-between;
    gap: 2rem;
    font-size: 0.66rem;
    font-variant-caps: all-small-caps;
    letter-spacing: 0.1em;
    color: var(--ink-faint);
    margin: 0;
  }
</style>
