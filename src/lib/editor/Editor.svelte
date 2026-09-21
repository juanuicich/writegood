<script lang="ts">
  import { onDestroy, onMount } from "svelte";
  import { Editor } from "@tiptap/core";
  import StarterKit from "@tiptap/starter-kit";
  import { Placeholder } from "@tiptap/extensions";
  import { app } from "../state.svelte";
  import { Findings, setFindings, type Mark } from "./findings";

  let host: HTMLDivElement;
  let editor: Editor | null = null;
  let saveTimer: ReturnType<typeof setTimeout> | undefined;

  onMount(() => {
    editor = new Editor({
      element: host,
      extensions: [
        StarterKit.configure({ link: { openOnClick: false } }),
        Placeholder.configure({ placeholder: "Write." }),
        Findings.configure({ onSelect: (id) => app.select(id) }),
      ],
      content: "",
      autofocus: "end",
      onUpdate: () => {
        app.dirty = true;
        clearTimeout(saveTimer);
        // Autosave is quiet and frequent; consecutive minor saves collapse
        // into one revision row, so this does not bury flagged revisions.
        saveTimer = setTimeout(() => void app.save(false), 1200);
      },
    });
    app.editor = editor;
  });

  onDestroy(() => {
    clearTimeout(saveTimer);
    editor?.destroy();
    app.editor = null;
  });

  // Push decorations whenever the placed findings or the selection change.
  $effect(() => {
    const current = app.current;
    const marks: Mark[] = app.findings
      .filter((f) => f.from !== null && f.to !== null && f.status !== "dismissed")
      .map((f) => ({
        id: f.id,
        from: f.from as number,
        to: f.to as number,
        severity: f.severity,
        stale: f.status === "stale",
        current: current?.id === f.id,
      }));
    if (editor) setFindings(editor, marks);
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
