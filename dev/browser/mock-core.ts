/** A stand-in for Tauri's `invoke`, so the interface can be opened in an
 *  ordinary browser and looked at.
 *
 *  Screenshots of the real window need screen-recording permission a terminal
 *  does not have, and driving it needs accessibility permission it also does
 *  not have. This is how the design gets reviewed. It serves fixed data and
 *  touches nothing on disk. */

const DRAFT = `# The Determination of the Committee

It was decided by the committee that a determination would be made regarding the proposal. Very few of the members had actually read it. Unfortunately, the meeting was conducted in a manner that was really quite unproductive.

There was an expectation that a resolution would be arrived at. No resolution was arrived at. The chair made the observation that time had expired, and the matter was tabled for a subsequent session.

Some of us left the room with the feeling that nothing had been accomplished. It is a feeling that is familiar. It is a feeling that recurs.
`;

const FINDINGS = [
  {
    id: 1,
    runId: 1,
    docId: 1,
    category: "nominalization",
    severity: "high",
    note: 'The action is buried in a noun. The verb is sitting inside "determination" doing nothing.',
    quote: "a determination would be made",
    prefix: "committee that ",
    suffix: " regarding the",
    status: "open",
    createdAt: "2026-09-22 00:10",
  },
  {
    id: 2,
    runId: 1,
    docId: 1,
    category: "passive-actor",
    severity: "medium",
    note: "The actor arrives late, in a by-phrase, after the action it performed.",
    quote: "It was decided by the committee",
    prefix: "",
    suffix: " that a determ",
    status: "open",
    createdAt: "2026-09-22 00:10",
  },
  {
    id: 3,
    runId: 1,
    docId: 1,
    category: "filler-words",
    severity: "low",
    note: "Two hedges stacked in front of one adjective. Neither carries information.",
    quote: "really quite unproductive",
    prefix: "manner that was ",
    suffix: ".",
    status: "open",
    createdAt: "2026-09-22 00:10",
  },
  {
    id: 4,
    runId: 1,
    docId: 1,
    category: "repeated-phrasing",
    severity: "medium",
    // Deliberately leaks wording, to exercise the Rule One guard.
    note: 'This buries its verb. Consider "the chair observed" instead, which is shorter.',
    quote: "The chair made the observation",
    prefix: "arrived at. ",
    suffix: " that time",
    status: "open",
    createdAt: "2026-09-22 00:10",
  },
  {
    id: 5,
    runId: 1,
    docId: 1,
    category: "topic-flow",
    severity: "low",
    note: "This sentence is no longer in the draft, so it reads as rewritten.",
    quote: "a paragraph that was removed some time ago",
    prefix: "",
    suffix: "",
    status: "open",
    createdAt: "2026-09-22 00:10",
  },
];

const CONFIG = {
  defaultProvider: "deepseek",
  judgeProvider: null,
  rules: {
    allowSuggestions: false,
    redactSuggestions: true,
    forbidPraise: true,
    blindJudge: true,
  },
  appearance: {
    font: "Literata, ui-serif, Georgia, serif",
    fontSize: 18,
    measure: 68,
    theme: new URLSearchParams(location.search).get("theme") ?? "light",
  },
  providers: { deepseek: { kind: "openai-compatible", args: [], timeoutSecs: 180 } },
};

const PASSES = [
  { slug: "nominalization", name: "Buried verbs", category: "nominalization", scope: "paragraph", provider: null, enabled: true, prompt: "", path: "" },
  { slug: "filler-words", name: "Sawdust", category: "filler", scope: "paragraph", provider: null, enabled: true, prompt: "", path: "" },
];

/** Exact, case-insensitive matching. Enough to place the fixtures. */
function resolveAnchors(text: string, selectors: { id: number; quote: string }[]) {
  const chars = Array.from(text);
  const hay = chars.join("").toLowerCase();
  return selectors.map((s) => {
    const at = hay.indexOf(s.quote.toLowerCase());
    if (at < 0) return { id: s.id, from: null, to: null, score: 0, exact: false };
    const from = Array.from(hay.slice(0, at)).length;
    return { id: s.id, from, to: from + Array.from(s.quote).length, score: 1, exact: true };
  });
}

export async function invoke(cmd: string, args: Record<string, unknown> = {}): Promise<unknown> {
  switch (cmd) {
    case "config_load":
      return CONFIG;
    case "config_paths":
      return { home: "~/.writegood", config: "", documents: "", passes: "", db: "" };
    case "passes_list":
      return PASSES;
    case "doc_list":
      return [
        { path: "/d/on-writing.md", title: "The Determination of the Committee", modified: 1, words: 105 },
        { path: "/d/notes.md", title: "Notes towards a second piece", modified: 0, words: 12 },
      ];
    case "doc_read":
      return DRAFT;
    case "db_register":
      return { id: 1, path: "/d/on-writing.md", title: "The Determination of the Committee", createdAt: "", updatedAt: "" };
    case "db_documents":
      return [];
    case "db_forget_missing":
      return 0;
    case "findings_list":
      return FINDINGS;
    case "findings_status":
    case "findings_clear":
    case "rev_flag":
    case "run_finish":
    case "doc_write":
      return null;
    case "rev_list":
      return [
        { id: 3, docId: 1, parentId: 2, contentJson: "{}", contentText: DRAFT, major: false, label: null, createdAt: "2026-09-22 00:09:41" },
        { id: 2, docId: 1, parentId: 1, contentJson: "{}", contentText: DRAFT.replace("Very few", "Few"), major: true, label: "after the first cuts", createdAt: "2026-09-21 23:40:02" },
        { id: 1, docId: 1, parentId: null, contentJson: "{}", contentText: "# The Determination\n\nA first attempt.", major: false, label: null, createdAt: "2026-09-21 22:58:15" },
      ];
    case "rev_save":
      return { id: 3, docId: 1, parentId: 2, contentJson: "{}", contentText: "", major: false, label: null, createdAt: "" };
    case "duel_list":
      return [];
    case "diff_words":
      return [
        { kind: "equal", text: "It was decided by the committee that " },
        { kind: "delete", text: "a determination would be made" },
        { kind: "insert", text: "they would decide" },
        { kind: "equal", text: " regarding the proposal." },
      ];
    case "anchors_resolve":
      return resolveAnchors(args.text as string, args.selectors as { id: number; quote: string }[]);
    default:
      console.warn("mock invoke:", cmd, args);
      return null;
  }
}
