<script lang="ts">
  import { app } from "../state.svelte";
  import { guard } from "./redact";

  let tops = $state<Record<number, number>>({});

  const draft = $derived(app.editor ? app.plainText() : "");
  const enabled = $derived(app.config?.rules.redactSuggestions ?? true);

  /** Place each note beside the text it refers to, then push overlapping ones
   *  down. This is the Genius margin, and it only works if it never covers a
   *  neighbour. */
  $effect(() => {
    const editor = app.editor;
    const list = app.visible;
    if (!editor || list.length === 0) {
      tops = {};
      return;
    }
    const next: Record<number, number> = {};
    let floor = 0;
    for (const f of list) {
      if (f.from === null) continue;
      let y = 0;
      try {
        y = editor.view.coordsAtPos(f.from).top;
      } catch {
        continue;
      }
      const placed = Math.max(y, floor);
      next[f.id] = placed;
      floor = placed + 58;
    }
    tops = next;
  });

  function toggle(id: number) {
    app.toggleReveal(id);
  }
</script>

<aside class="margin scroll">
  {#each app.visible as f (f.id)}
    <article
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
    width: 22rem;
    flex: 0 0 22rem;
    padding: 14vh 1.6rem 40vh 0;
    font-size: 0.72em;
    line-height: 1.5;
    color: var(--ink-soft);
  }

  .note {
    position: absolute;
    right: 1.6rem;
    width: 19rem;
    opacity: 0.55;
    transition: opacity 120ms ease;
  }
  .note:hover { opacity: 0.85; }
  .note.current { opacity: 1; color: var(--ink); }
  .note.stale { opacity: 0.3; }
  .note.done { text-decoration: line-through; opacity: 0.3; }

  .hit { display: block; text-align: left; width: 100%; }

  header {
    display: flex;
    gap: 0.5rem;
    align-items: baseline;
    margin-bottom: 0.25rem;
  }

  .cat {
    font-variant-caps: all-small-caps;
    letter-spacing: 0.09em;
    color: var(--ink-faint);
  }

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
    right: 1.6rem;
    color: var(--ink-faint);
    font-variant-caps: all-small-caps;
    letter-spacing: 0.09em;
  }
</style>
