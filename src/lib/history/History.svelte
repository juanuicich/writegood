<script lang="ts">
  import { app } from "../state.svelte";

  /** A revision's line in the list: when, and what you called it. */
  function line(index: number): string {
    const h = app.history!;
    const r = h.revisions[index];
    const when = r.createdAt.replace(" ", " · ").slice(0, 16);
    if (r.major) return `${when}  ${r.label ?? "major"}`;
    return `${when}`;
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
    max-width: var(--measure);
    margin: 0 auto;
    padding: 0 max(3rem, 4vw);
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

  .same { color: var(--ink-soft); }

  ins {
    text-decoration: underline;
    text-decoration-thickness: 1px;
    text-underline-offset: 0.22em;
    color: var(--ink);
  }

  del {
    text-decoration: line-through;
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
