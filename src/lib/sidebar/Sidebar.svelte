<script lang="ts">
  import { tick } from "svelte";
  import { app } from "../state.svelte";
  import { guard } from "./redact";

  let tops = $state<Record<number, number>>({});
  /** Measured note heights, so stacking uses real sizes rather than a guess. */
  let heights = $state<Record<number, number>>({});
  let band = $state<HTMLElement | null>(null);
  /** Which ends of the band currently cut a note in half. Only a cut end is
   *  faded, so a note that fits is never dimmed. */
  let fade = $state<"none" | "top" | "bottom" | "both">("none");
  /** Must match the fade length in the .band mask below. */
  const FADE = 26;
  /** Bumped when the prose moves under the margin, or the margin is scrolled
   *  by hand, so the notes are placed and the fades recomputed. */
  let moved = $state(0);
  /** How tall the notes reach. The band scrolls its own content, so it needs
   *  a track at least as tall as the prose it mirrors. */
  let trackHeight = $state(0);

  /** How far the margin sits past level with the prose. Zero keeps each note
   *  beside its sentence. The reader's wheel sets it, and so does revealing a
   *  note that is stacked further down than the draft can scroll. The next
   *  scroll of the draft by the reader sets it back to zero. */
  let offset = 0;
  /** Set while we move the margin ourselves, so our own scroll event is not
   *  mistaken for the reader's. */
  let selfScroll = false;
  /** Set while we move the draft ourselves, so revealing a note does not
   *  count as the reader taking the lead back. */
  let revealing = false;
  /** Where the first note starts and the last note ends, in the band's
   *  coordinates. The reader's wheel stops there. */
  let span = { first: 0, last: 0 };

  /** The page the prose scrolls in. */
  function pageEl(): HTMLElement | null {
    return (app.editor?.view.dom.closest(".page") as HTMLElement | null) ?? null;
  }

  /** Notes are placed in the prose's own scroll coordinates, so the number
   *  for a note does not change when either pane scrolls. To show a note
   *  beside its sentence the band's scrollTop must lead the page's by the
   *  distance between their tops. */
  function alignedScrollTop(page: HTMLElement, el: HTMLElement): number {
    return page.scrollTop + el.getBoundingClientRect().top - page.getBoundingClientRect().top;
  }

  /** Move the margin, marking the move as ours only if it happened: a value
   *  the browser clamps to where it already is fires no scroll event, and a
   *  flag left set would swallow the reader's next scroll. */
  function setBand(top: number) {
    if (!band) return;
    const before = band.scrollTop;
    band.scrollTop = top;
    if (Math.abs(band.scrollTop - before) >= 1) selfScroll = true;
  }

  /** Put the margin where alignment and the offset say. */
  function settle() {
    const page = pageEl();
    if (!page || !band) return;
    setBand(alignedScrollTop(page, band) + offset);
  }

  const GAP = 18;

  const draft = $derived(app.editor ? app.plainText() : "");
  const enabled = $derived(app.config?.rules.redactSuggestions ?? true);

  /** The margin mirrors the prose, so it has to be told when the prose moves.
   *  Without this the notes keep the positions they had before the first
   *  scroll and drift away from the sentences they point at. */
  $effect(() => {
    const page = pageEl();
    const el = band;
    if (!page || !el) return;
    // The prose leads: scrolling it brings the margin along, so a note stays
    // beside its sentence.
    const follow = () => {
      if (revealing) revealing = false;
      else offset = 0;
      settle();
      moved += 1;
    };
    // Scrolling the margin by hand leads nowhere else, so you can read ahead
    // without moving the draft. It stops when the first or last note reaches
    // the edge: the track is tall enough to stay level with any part of the
    // draft, and the reader has no use for the empty stretch beyond the notes.
    const bump = () => {
      if (selfScroll) {
        selfScroll = false;
      } else {
        const level = alignedScrollTop(page, el);
        const lo = Math.min(level, span.first - GAP);
        const hi = Math.max(level, span.last + GAP - el.clientHeight);
        const top = Math.min(Math.max(el.scrollTop, lo), hi);
        if (Math.abs(top - el.scrollTop) >= 1) setBand(top);
        offset = top - level;
      }
      moved += 1;
    };
    page.addEventListener("scroll", follow, { passive: true });
    el.addEventListener("scroll", bump, { passive: true });
    window.addEventListener("resize", follow);
    return () => {
      page.removeEventListener("scroll", follow);
      el.removeEventListener("scroll", bump);
      window.removeEventListener("resize", follow);
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
    const page = pageEl();
    if (!page) return;
    // Measure against the prose's scroll content, not the viewport, so a
    // number stays valid however either pane is scrolled.
    const origin = page.getBoundingClientRect().top - page.scrollTop;
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

    // The track must cover the prose, so the margin can always scroll far
    // enough to stay level with it, and cover the lowest note besides. It
    // also leaves a band's height below the last note, so aligning any note
    // to a clicked highlight can lift it as high as the highlight sits. The
    // wheel stops at the last note, so the reader never scrolls into that.
    const lead = band.getBoundingClientRect().top - page.getBoundingClientRect().top;
    trackHeight = Math.max(floor + band.clientHeight, page.scrollHeight + lead);

    const extents = Object.entries(next).map(([id, y]) => [y, y + (heights[Number(id)] ?? 56)]);
    span = {
      first: Math.min(...extents.map(([y]) => y)),
      last: Math.max(...extents.map(([, end]) => end)),
    };

    settle();

    // Only an end that actually cuts a note is faded.
    const top = band.scrollTop;
    const height = band.clientHeight;
    let cutTop = false;
    let cutBottom = false;
    for (const [id, y] of Object.entries(next)) {
      const h = heights[Number(id)] ?? 56;
      if (y + h > top && y < top) cutTop = true;
      if (y < top + height && y + h > top + height) cutBottom = true;
    }
    fade = cutTop && cutBottom ? "both" : cutTop ? "top" : cutBottom ? "bottom" : "none";
  });

  /** Moving the focus must bring the focused note into the band. Stepping with
   *  j or k scrolls the prose, but stacking can still leave the note below the
   *  foot of the band. A click on a highlight goes further and sets the note
   *  level with it (SPEC §12.3). Every focus change bumps `seq`, so clicking
   *  the same highlight again aligns it again. */
  $effect(() => {
    const { by } = app.focus;
    const id = app.current?.id;
    if (id === undefined) return;
    // Read the layout after the DOM has caught up, and outside the effect's
    // dependencies, so a scroll of our own does not retrigger this.
    void tick().then(() => (by === "text" ? align(id) : reveal(id)));
  });

  /** Scroll the margin until the note's top is level with its highlight. The
   *  draft stays put: the reader just clicked those words. The offset holds
   *  until the reader next scrolls the draft. */
  function align(id: number) {
    const page = pageEl();
    const card = band?.querySelector<HTMLElement>(`[data-note="${id}"]`);
    const f = app.visible.find((x) => x.id === id);
    if (!page || !band || !card || !app.editor || f?.from == null) return;
    // By position, as the notes are placed: an overlapped highlight has no
    // span of its own to measure.
    let words: number;
    try {
      words = app.editor.view.coordsAtPos(f.from).top;
    } catch {
      return;
    }
    const delta = card.getBoundingClientRect().top - words;
    if (Math.abs(delta) < 1) return;
    const want = band.scrollTop + delta;
    offset = want - alignedScrollTop(page, band);
    setBand(want);
  }

  /** Bring the focused note into the band. The draft moves first, so the
   *  sentence comes along. Stacking can put a note further down than the draft
   *  can scroll, and then the margin moves by itself for the rest. */
  function reveal(id: number) {
    const page = pageEl();
    const card = band?.querySelector<HTMLElement>(`[data-note="${id}"]`);
    if (!page || !band || !card) return;
    const edge = band.getBoundingClientRect();
    const note = card.getBoundingClientRect();
    // A faded end hides whatever sits under it, so treat it as out of view.
    const head = fade === "top" || fade === "both" ? FADE : 0;
    const foot = fade === "bottom" || fade === "both" ? FADE : 0;
    const below = note.bottom - (edge.bottom - foot);
    const above = edge.top + head - note.top;
    const delta = below > 1 ? below : above > 1 ? -above : 0;
    if (delta === 0) return;

    const want = band.scrollTop + delta;
    const before = page.scrollTop;
    page.scrollTop = before + delta;
    if (Math.abs(page.scrollTop - before) >= 1) revealing = true;
    offset = want - alignedScrollTop(page, band);
    setBand(want);
  }

  function toggle(id: number) {
    app.toggleReveal(id);
  }
</script>

<aside class="margin">
  <div class="band scroll" data-fade={fade} bind:this={band}>
    <div class="track" style:height="{trackHeight}px">
    {#each app.visible as f (f.id)}
      <article
        bind:clientHeight={heights[f.id]}
        data-note={f.id}
        class="note"
        class:current={app.lit.includes(f.id)}
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
    </div>

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
    font-size: 0.8em;
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
    /* The margin scrolls on its own. The prose leads it, so a note sits
       beside its sentence, but the wheel over the margin moves only the
       margin. Findings outrun the window often, and clipping them made the
       text show more highlights than the margin showed notes. */
    overflow-x: hidden;
    overscroll-behavior: contain;
  }
  .track {
    position: relative;
    width: 100%;
  }
  /* A note that runs past either end of the band is cut off. Fade the cut, or
     half a card reads as a rendering fault. Fade only the end that cuts one:
     an unconditional fade dims a last note that is fully in view. */
  .band[data-fade="top"] {
    mask-image: linear-gradient(to bottom, transparent 0, #000 1.6rem);
  }
  .band[data-fade="bottom"] {
    mask-image: linear-gradient(to bottom, #000 calc(100% - 1.6rem), transparent 100%);
  }
  .band[data-fade="both"] {
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
