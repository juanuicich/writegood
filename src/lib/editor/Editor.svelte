<script lang="ts">
  import { onDestroy, onMount, untrack } from "svelte";
  import { Editor } from "@tiptap/core";
  import StarterKit from "@tiptap/starter-kit";
  import { Placeholder } from "@tiptap/extensions";
  import { app } from "../state.svelte";
  import { Findings, setFindings, setFocus, type Mark } from "./findings";

  let host: HTMLDivElement;
  let editor: Editor | null = null;
  let saveTimer: ReturnType<typeof setTimeout> | undefined;
  let anchorTimer: ReturnType<typeof setTimeout> | undefined;

  onMount(() => {
    editor = new Editor({
      element: host,
      extensions: [
        StarterKit.configure({ link: { openOnClick: false } }),
        Placeholder.configure({ placeholder: "Write." }),
        Findings.configure({ onSelect: (ids) => app.selectInText(ids) }),
      ],
      content: "",
      autofocus: "end",
      onUpdate: () => {
        app.dirty = true;
        clearTimeout(saveTimer);
        // Autosave is quiet and frequent; consecutive minor saves collapse
        // into one revision row, so this does not bury flagged revisions.
        saveTimer = setTimeout(() => void app.save(false), 1200);
        // ProseMirror moves the highlights as you type, but the stored
        // offsets go stale. Re-anchor sooner than the save, so the store
        // and the screen agree again before anything else reads them.
        clearTimeout(anchorTimer);
        anchorTimer = setTimeout(() => void app.reanchor(), 400);
      },
    });
    app.editor = editor;
  });

  onDestroy(() => {
    clearTimeout(saveTimer);
    clearTimeout(anchorTimer);
    editor?.destroy();
    app.editor = null;
  });

  // Positions. This runs when the findings change, which means the store has
  // just re-anchored. The focused id is read without subscribing to it, so a
  // focus change alone never repaints stored offsets over mapped ones.
  $effect(() => {
    const findings = app.findings;
    const lit = untrack(() => app.lit);
    const marks: Mark[] = findings
      .filter((f) => f.from !== null && f.to !== null && f.status !== "dismissed")
      .map((f) => ({
        id: f.id,
        from: f.from as number,
        to: f.to as number,
        severity: f.severity,
        stale: f.status === "stale",
        current: lit.includes(f.id),
      }));
    if (editor) setFindings(editor, marks);
  });

  // Focus only. Restyles the decorations where the mapping left them.
  $effect(() => {
    const lit = app.lit;
    if (editor) setFocus(editor, lit);
  });
</script>

<div class="page scroll">
  <div bind:this={host}></div>
</div>

<style>
  .page {
    height: 100%;
    padding: 0 max(3rem, 4vw);
  }
</style>
