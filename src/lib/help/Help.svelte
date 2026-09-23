<script lang="ts">
  import { Editor } from "@tiptap/core";
  import StarterKit from "@tiptap/starter-kit";
  import { app } from "../state.svelte";
  import { markdownToJSON } from "../markdown";
  import { isHelpKey } from "./keys";
  import { localiseMarkdown } from "../shortcuts";
  import text from "./help.md?raw";

  let host = $state<HTMLDivElement | null>(null);

  // The help is a document, shown in an editor like any draft, so it reads
  // the same. It is not editable. It is a second editor, so the draft's own
  // editor is never touched.
  $effect(() => {
    if (!host) return;
    const editor = new Editor({
      element: host,
      extensions: [StarterKit.configure({ link: { openOnClick: false } })],
      content: markdownToJSON(localiseMarkdown(text)),
      editable: false,
    });
    return () => editor.destroy();
  });

  /** The sheet takes the keyboard while it is open, as the other sheets do.
   *  Text size still reaches App, which handles it before the sheets. */
  function keydown(e: KeyboardEvent) {
    // Esc in the command bar closes the bar, not the help under it.
    if (app.paletteOpen) return;
    // The ⌘? that opened the help reaches this listener too, in the same
    // dispatch. App has already handled it.
    if (e.defaultPrevented) return;
    if (e.key === "Escape" || isHelpKey(e)) {
      e.preventDefault();
      app.closeHelp();
    }
  }
</script>

<svelte:window onkeydown={app.help ? keydown : undefined} />

{#if app.help}
  <div class="sheet page scroll">
    <div bind:this={host}></div>
  </div>
{/if}

<style>
  .sheet {
    position: fixed;
    inset: 0;
    background: var(--paper);
  }

  .page {
    padding: 0 max(3rem, 4vw);
  }
</style>
