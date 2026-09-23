<script lang="ts">
  import { app } from "../state.svelte";

  /** SQLite stores `datetime('now')`, which is UTC with no marker. Say so, or
   *  every timestamp reads hours wrong. */
  function when(stamp: string): string {
    const d = new Date(stamp.replace(" ", "T") + "Z");
    if (Number.isNaN(d.getTime())) return stamp;
    return d.toLocaleString(undefined, {
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  /** A revision's line in the list: when, and what you called it. */
  function line(index: number): string {
    const r = app.history!.revisions[index];
    return r.major ? `${when(r.createdAt)}   ${r.label ?? "major"}` : when(r.createdAt);
  }

  function keydown(e: KeyboardEvent) {
    if (e.key === "Escape") {
      e.preventDefault();
      app.closeHistory();
    } else if (e.key === "j" || e.key === "n" || e.key === "ArrowDown") {
      e.preventDefault();
      void app.stepHistory(1);
    } else if (e.key === "k" || e.key === "p" || e.key === "ArrowUp") {
      e.preventDefault();
      void app.stepHistory(-1);
    } else if (e.key === "Enter") {
      e.preventDefault();
      void app.restoreHistory();
    }
  }
</script>

<svelte:window onkeydown={app.history ? keydown : undefined} />

{#if app.history}
  {@const h = app.history}
  <div class="sheet">
    <div class="inner">
      <ol class="list">
        {#each h.revisions as r, i (r.id)}
          <li class:on={i === h.index} class:major={r.major}>
            <button onclick={() => app.stepHistory(i - h.index)}>{line(i)}</button>
          </li>
        {/each}
      </ol>

      <p class="label">
        what has changed since — additions underlined, removals struck through
      </p>

      <p class="diff">
        {#each h.chunks as c}
          {#if c.kind === "equal"}<span class="same">{c.text}</span>
          {:else if c.kind === "insert"}<ins>{c.text}</ins>
          {:else}<del>{c.text}</del>{/if}
        {/each}
      </p>

      <p class="foot">enter to put this version back · esc to close</p>
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

  .list {
    list-style: none;
    margin: 0 0 3rem;
    padding: 0;
    font-size: 0.72rem;
    font-variant-numeric: tabular-nums;
  }

  .list li { color: var(--ink-faint); }
  .list li.major { color: var(--ink-soft); }
  .list li.on { color: var(--ink); }
  .list li.on button::before { color: var(--accent); }
  .list li.on button::before { content: "— "; }
  .list button { display: block; width: 100%; text-align: left; padding: 0.1rem 0; }

  .label {
    font-size: 0.66rem;
    font-variant-caps: all-small-caps;
    letter-spacing: 0.1em;
    color: var(--ink-faint);
    margin: 0 0 0.8rem;
  }

  .diff {
    margin: 0 0 2.4rem;
    white-space: pre-wrap;
  }

  /* A deletion and the insertion that replaced it sit flush against each
     other. Give them room, or they read as one mangled word. */
  ins, del {
    padding: 0 0.12em;
    border-radius: 2px;
  }

  .same { color: var(--ink-soft); }

  ins {
    text-decoration: underline;
    text-decoration-thickness: 1px;
    text-underline-offset: 0.22em;
    text-decoration-color: var(--tertiary);
    color: var(--ink);
  }

  del {
    text-decoration: line-through;
    text-decoration-thickness: 1px;
    color: var(--ink-faint);
  }

  .foot {
    font-size: 0.66rem;
    font-variant-caps: all-small-caps;
    letter-spacing: 0.1em;
    color: var(--ink-faint);
    margin: 0;
  }
</style>
