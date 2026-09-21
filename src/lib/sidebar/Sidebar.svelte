<script lang="ts">
  import { app } from "../state.svelte";
  import { guard } from "./redact";

  let tops = $state<Record<number, number>>({});
  /** Measured note heights, so stacking uses real sizes rather than a guess. */
  let heights = $state<Record<number, number>>({});
  let host = $state<HTMLElement | null>(null);

  const GAP = 18;

  const draft = $derived(app.editor ? app.plainText() : "");
  const enabled = $derived(app.config?.rules.redactSuggestions ?? true);

  /** Place each note beside the text it refers to, then push overlapping ones
   *  down. This is the Genius margin, and it only works if it never covers a
   *  neighbour. */
  $effect(() => {
    const editor = app.editor;
    const list = app.visible;
    // Re-run when a note is measured or the document changes under it.
    void heights;
    void app.findings;
    if (!editor || !host || list.length === 0) {
      tops = {};
      return;
    }
    const origin = host.getBoundingClientRect().top;
    const next: Record<number, number> = {};
    let floor = -Infinity;
    for (const f of list) {
      if (f.from === null) continue;
      let y: number;
      try {
        y = editor.view.coordsAtPos(f.from).top - origin;
      } catch {
        continue;
      }
      const placed = Math.max(y, floor);
      next[f.id] = placed;
      floor = placed + (heights[f.id] ?? 56) + GAP;
    }
    tops = next;
  });

  function toggle(id: number) {
    app.toggleReveal(id);
  }
</script>

<aside class="margin scroll" bind:this={host}>
  {#each app.visible as f (f.id)}
    <article
      bind:clientHeight={heights[f.id]}
      class="note"
      class:current={app.current?.id === f.id}
      class:stale={f.status === "stale"}
      class:done={f.status === "addressed"}
      style:top={tops[f.id] !== undefined ? `${tops[f.id]}px` : undefined}
    >
      <button class="hit" onclick={() => app.select(f.id)}>
        <header>
          <span class="cat">{f.category}</span>
          {#if f.status === "stale"}<span class="tag">rewritten</span>{/if}
          {#if f.status === "addressed"}<span class="tag">done</span>{/if}
        </header>
        <p>
          {#each guard(f.note, draft, enabled) as seg}
            {#if seg.redacted && !app.revealed.includes(f.id)}
              <span
                class="blocked"
                role="button"
                tabindex="0"
                onclick={(e) => {
                  e.stopPropagation();
                  toggle(f.id);
                }}
                onkeydown={(e) => e.key === "Enter" && toggle(f.id)}
                title="The model wrote wording of its own here. Press r to read it."
                >wording withheld</span
              >
            {:else}{seg.text}{/if}
          {/each}
        </p>
      </button>
    </article>
  {/each}

  {#if app.visible.length === 0}
    <p class="empty">no findings</p>
  {/if}
</aside>

<style>
  .margin {
    position: relative;
    height: 100%;
    width: 23rem;
    flex: 0 0 23rem;
    padding: 14vh 2rem 40vh 1.4rem;
    font-size: 0.7em;
    line-height: 1.55;
    color: var(--ink-soft);
  }

  .note {
    position: absolute;
    right: 2rem;
    width: 19rem;
    opacity: 0.55;
    transition: opacity 120ms ease;
  }
  .note:hover { opacity: 0.85; }
  .note.current { opacity: 1; color: var(--ink); }
  /* A hairline in the margin, the only colour on this pane. */
  .note.current::before {
    content: "";
    position: absolute;
    left: -0.9rem;
    top: 0.15em;
    bottom: 0.15em;
    width: 2px;
    background: var(--accent);
  }
  .note.stale { opacity: 0.3; }
  .note.done { text-decoration: line-through; opacity: 0.3; }

  .hit { display: block; text-align: left; width: 100%; }

  header {
    display: flex;
    gap: 0.5rem;
    align-items: baseline;
    margin-bottom: 0.3rem;
  }

  .cat {
    font-variant-caps: all-small-caps;
    letter-spacing: 0.09em;
    color: var(--ink-faint);
  }
  .note.current .cat { color: var(--accent); }

  .tag {
    font-variant-caps: all-small-caps;
    letter-spacing: 0.09em;
    color: var(--ink-faint);
  }

  p { margin: 0; }

  .blocked {
    background: var(--wash-deep);
    color: transparent;
    border-radius: 2px;
    padding: 0 0.3em;
    cursor: pointer;
    user-select: none;
  }

  .empty {
    position: absolute;
    right: 2rem;
    color: var(--ink-faint);
    font-variant-caps: all-small-caps;
    letter-spacing: 0.09em;
  }
</style>
