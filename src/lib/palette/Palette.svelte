<script module lang="ts">
  export interface Command {
    id: string;
    label: string;
    hint?: string;
    /** When set, the palette asks for a value before running. */
    argument?: string;
    /** When set, the palette offers these instead of free text. */
    choices?: () => { value: string; label: string; hint?: string }[];
    run: (arg?: string) => unknown;
  }
</script>

<script lang="ts">
  import { app } from "../state.svelte";

  let { commands }: { commands: Command[] } = $props();

  let query = $state("");
  let selected = $state(0);
  let pending = $state<Command | null>(null);
  let field = $state<HTMLInputElement | null>(null);

  const options = $derived.by(() => {
    if (pending?.choices) {
      return pending
        .choices()
        .filter((c) => match(c.label, query))
        .map((c) => ({ key: c.value, label: c.label, hint: c.hint }));
    }
    if (pending) return [];
    return commands
      .filter((c) => match(c.label, query))
      .map((c) => ({ key: c.id, label: c.label, hint: c.hint }));
  });

  function match(label: string, q: string) {
    if (!q) return true;
    const l = label.toLowerCase();
    let i = 0;
    for (const ch of q.toLowerCase()) {
      i = l.indexOf(ch, i);
      if (i < 0) return false;
      i += 1;
    }
    return true;
  }

  $effect(() => {
    if (app.paletteOpen) {
      query = "";
      selected = 0;
      pending = null;
      queueMicrotask(() => field?.focus());
    }
  });

  $effect(() => {
    void options;
    if (selected >= options.length) selected = Math.max(0, options.length - 1);
  });

  function close() {
    app.paletteOpen = false;
    pending = null;
    query = "";
    app.editor?.commands.focus();
  }

  async function choose() {
    if (pending) {
      if (pending.choices) {
        const pick = options[selected];
        if (!pick) return;
        const cmd = pending;
        close();
        await cmd.run(pick.key);
      } else {
        const cmd = pending;
        const value = query;
        close();
        await cmd.run(value);
      }
      return;
    }
    const pick = options[selected];
    if (!pick) return;
    const cmd = commands.find((c) => c.id === pick.key);
    if (!cmd) return;
    if (cmd.argument || cmd.choices) {
      pending = cmd;
      query = "";
      selected = 0;
      return;
    }
    close();
    await cmd.run();
  }

  function keydown(e: KeyboardEvent) {
    if (e.key === "Escape") {
      e.preventDefault();
      if (pending) {
        pending = null;
        query = "";
      } else close();
    } else if (e.key === "ArrowDown" || (e.key === "n" && e.ctrlKey)) {
      e.preventDefault();
      selected = Math.min(selected + 1, options.length - 1);
    } else if (e.key === "ArrowUp" || (e.key === "p" && e.ctrlKey)) {
      e.preventDefault();
      selected = Math.max(selected - 1, 0);
    } else if (e.key === "Enter") {
      e.preventDefault();
      void choose();
    }
  }
</script>

{#if app.paletteOpen}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="veil" onclick={close}></div>
  <div class="bar">
    <input
      bind:this={field}
      bind:value={query}
      onkeydown={keydown}
      placeholder={pending ? (pending.argument ?? pending.label) : "…"}
      spellcheck="false"
      autocomplete="off"
    />
    {#if options.length > 0}
      <ul>
        {#each options as o, i (o.key)}
          <!-- svelte-ignore a11y_click_events_have_key_events -->
          <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
          <li
            class:on={i === selected}
            onmouseenter={() => (selected = i)}
            onclick={choose}
          >
            <span>{o.label}</span>
            {#if o.hint}<span class="hint">{o.hint}</span>{/if}
          </li>
        {/each}
      </ul>
    {/if}
  </div>
{/if}

<style>
  .veil {
    position: fixed;
    inset: 0;
    background: var(--paper);
    opacity: 0.86;
  }

  .bar {
    position: fixed;
    top: 22vh;
    left: 50%;
    transform: translateX(-50%);
    width: min(42rem, 88vw);
    background: var(--paper);
    border-bottom: 1px solid var(--ink);
    padding-bottom: 0.4rem;
  }

  input {
    font-size: 1.35rem;
    line-height: 1.4;
    padding: 0.2rem 0;
  }

  ul {
    list-style: none;
    margin: 0.7rem 0 0;
    padding: 0;
    max-height: 46vh;
    overflow-y: auto;
    font-size: 0.82rem;
  }

  li {
    display: flex;
    justify-content: space-between;
    gap: 1rem;
    padding: 0.28rem 0.4rem;
    color: var(--ink-soft);
    cursor: pointer;
  }
  li.on {
    color: var(--ink);
    background: var(--wash);
  }

  .hint {
    color: var(--ink-faint);
    font-variant-caps: all-small-caps;
    letter-spacing: 0.08em;
    white-space: nowrap;
  }
</style>
