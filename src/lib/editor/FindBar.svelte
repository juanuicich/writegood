<script lang="ts">
  import { tick } from "svelte";
  import { app } from "../state.svelte";
  import { count, countLabel } from "./search";

  let findField = $state<HTMLInputElement | null>(null);
  let replaceField = $state<HTMLInputElement | null>(null);
  let counted = $state({ total: 0, index: 0 });

  /** The count follows every edit and every step, whoever made it. */
  $effect(() => {
    const editor = app.editor;
    if (!editor || !app.find) return;
    const update = () => (counted = count(editor.state));
    update();
    editor.on("transaction", update);
    return () => {
      editor.off("transaction", update);
    };
  });

  /** Each open selects a field: the replace field when it was asked for and
   *  there is already something to find, else the find field. */
  $effect(() => {
    const open = app.find;
    if (!open) return;
    void open.seq;
    void tick().then(() => {
      const field = open.replace && app.findText ? replaceField : findField;
      field?.focus();
      field?.select();
    });
  });

  function findKeys(e: KeyboardEvent) {
    if (e.key === "Enter") {
      e.preventDefault();
      app.findStep(e.shiftKey ? -1 : 1);
    } else if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      app.closeFind(true);
    }
  }

  function replaceKeys(e: KeyboardEvent) {
    if (e.key === "Enter") {
      e.preventDefault();
      if (e.altKey) app.replaceAll();
      else app.replaceOne();
    } else if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      app.closeFind(true);
    }
  }
</script>

{#if app.find && app.mode === "write"}
  <div class="find">
    <div class="row">
      <label for="find-field">find</label>
      <input
        id="find-field"
        bind:this={findField}
        bind:value={app.findText}
        oninput={() => app.search(true)}
        onkeydown={findKeys}
        spellcheck="false"
        autocomplete="off"
      />
      <span class="count">{app.findText ? countLabel(counted) : ""}</span>
    </div>
    {#if app.find.replace}
      <div class="row">
        <label for="replace-field">replace</label>
        <input
          id="replace-field"
          bind:this={replaceField}
          bind:value={app.replaceText}
          oninput={() => app.search(false)}
          onkeydown={replaceKeys}
          spellcheck="false"
          autocomplete="off"
        />
        <span class="count"></span>
      </div>
    {/if}
  </div>
{/if}

<style>
  /* A strip of paper over the top of the page, on the text's own measure,
     so it reads as part of the draft rather than a toolbar. The fields line
     up with the text and the labels hang in the margin to their left. */
  .find {
    position: absolute;
    top: 1.4rem;
    left: max(3rem, 4vw);
    right: max(3rem, 4vw);
    max-width: var(--measure);
    margin: 0 auto;
    padding: 0.35rem 0 0.5rem;
    background: var(--paper);
    z-index: 2;
  }

  .row {
    position: relative;
    display: flex;
    align-items: baseline;
    gap: 1.2rem;
  }
  .row + .row { margin-top: 0.3rem; }

  label, .count {
    font-size: 0.8em;
    color: var(--ink-faint);
    font-variant-caps: all-small-caps;
    letter-spacing: 0.09em;
    white-space: nowrap;
  }
  /* The input's line, 1.5 of the body, in the label's smaller em, so the
     two share a baseline. */
  label {
    position: absolute;
    right: calc(100% + 1.2rem);
    line-height: 1.875;
  }
  .count {
    flex: 0 0 6rem;
    text-align: right;
    font-variant-numeric: tabular-nums;
  }

  /* The palette's rule under what you type. */
  input {
    flex: 1 1 auto;
    min-width: 0;
    line-height: 1.5;
    padding: 0 0 0.15rem;
    border-bottom: 1px solid var(--rule);
    color: var(--ink);
  }
  input:focus { border-bottom-color: var(--primary); }
</style>
