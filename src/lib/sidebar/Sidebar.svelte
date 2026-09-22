<script lang="ts">
  import { tick } from "svelte";
  import { app } from "../state.svelte";
  import { guard } from "./redact";

  let tops = $state<Record<number, number>>({});
  /** Measured note heights, so stacking uses real sizes rather than a guess. */
  let heights = $state<Record<number, number>>({});
  let band = $state<HTMLElement | null>(null);
  /** Bumped when the prose moves under the margin, so the notes follow it. */
  let moved = $state(0);

  const GAP = 18;

  const draft = $derived(app.editor ? app.plainText() : "");
  const enabled = $derived(app.config?.rules.redactSuggestions ?? true);

  /** The margin mirrors the prose, so it has to be told when the prose moves.
   *  Without this the notes keep the positions they had before the first
   *  scroll and drift away from the sentences they point at. */
  $effect(() => {
    const page = app.editor?.view.dom.closest(".page") as HTMLElement | null;
    if (!page) return;
    const bump = () => (moved += 1);
    page.addEventListener("scroll", bump, { passive: true });
    window.addEventListener("resize", bump);
    return () => {
      page.removeEventListener("scroll", bump);
      window.removeEventListener("resize", bump);
    };
  });

  /** Place each note beside the text it refers to, then push overlapping ones
   *  down. This is the Genius margin, and it only works if it never covers a
   *  neighbour. The band clips it, so a note never rides over the top edge or
   *  under the status bar. */
  $effect(() => {
    const editor = app.editor;
    const list = app.visible;
    // Re-run when a note is measured, the document changes under it, or the
    // prose scrolls.
    void heights;
    void app.findings;
    void moved;
    if (!editor || !band || list.length === 0) {
      tops = {};
      return;
    }
    const origin = band.getBoundingClientRect().top;
    const next: Record<number, number> = {};
    // Notes for text above the band are not pinned to its top edge. They are
    // let past it and clipped, or a long document's earlier notes would pile
    // up at the top and push the visible ones out of line with the prose.
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

  /** Moving the focus must bring the focused note into the band. Stepping with
   *  j or k scrolls the prose, but stacking can still leave the note below the
   *  foot of the band, and clicking a highlight moves the focus without
   *  moving the prose at all. */
  $effect(() => {
    const id = app.current?.id;
    if (id === undefined) return;
    // Read the layout after the DOM has caught up, and outside the effect's
    // dependencies, so a scroll of our own does not retrigger this.
    void tick().then(() => reveal(id));
  });

  function reveal(id: number) {
    const page = app.editor?.view.dom.closest(".page") as HTMLElement | null;
    const card = band?.querySelector<HTMLElement>(`[data-note="${id}"]`);
    if (!page || !band || !card) return;
    const edge = band.getBoundingClientRect();
    const note = card.getBoundingClientRect();
    const below = note.bottom - edge.bottom;
    const above = edge.top - note.top;
    if (below > 1) page.scrollTop += below;
    else if (above > 1) page.scrollTop -= above;
  }

  function toggle(id: number) {
    app.toggleReveal(id);
  }
</script>

<aside class="margin">
  <div class="band" bind:this={band}>
    {#each app.visible as f (f.id)}
      <article
        bind:clientHeight={heights[f.id]}
        data-note={f.id}
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
  </div>
</aside>

<style>
  .margin {
    position: relative;
    height: 100%;
    width: 23rem;
    flex: 0 0 23rem;
    font-size: 0.7em;
    line-height: 1.55;
    color: var(--ink-soft);
  }

  /* The notes live in a band with the same space at each end. The foot of the
     band sits above the status bar, so the last note clears it. */
  .band {
    position: absolute;
    top: var(--band);
    bottom: var(--band);
    left: 0;
    right: 2rem;
    overflow: hidden;
    /* A note that runs past either end of the band is cut off. Fade the cut,
       or a half a card reads as a rendering fault. */
    mask-image: linear-gradient(
      to bottom,
      transparent 0,
      #000 1.6rem,
      #000 calc(100% - 1.6rem),
      transparent 100%
    );
  }

  .note {
    position: absolute;
    right: 0;
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
    right: 0;
    color: var(--ink-faint);
    font-variant-caps: all-small-caps;
    letter-spacing: 0.09em;
  }
</style>
