import { expect, it } from "vitest";
import { EditorState, Text } from "@codemirror/state";
import { history, undo } from "@codemirror/commands";
import {
  collectRichSpans,
  parsedPreview,
  richPreviewState,
} from "../src/editor/liveBlocks";
import type { RenderNode } from "../src/services/api";

function node(
  kind: string,
  from: number,
  to: number,
  children: RenderNode[] = [],
): RenderNode {
  return {
    kind,
    from,
    to,
    children,
    line: 1,
    endLine: 1,
    text: "",
    target: "",
    level: 0,
  };
}
it("keeps multiline inline comments collapsible and excludes ranges inside callouts", () => {
  const source =
    "before %%hidden\ntext%% after\n\n> [!note]\n> %%one%% %%two%%\n";
  const doc = Text.of(source.split("\n"));
  const from = source.indexOf("%%"),
    to = source.indexOf("%% after") + 2;
  const callout = node("callout", source.indexOf(">"), source.length);
  const spans = collectRichSpans(
    [
      node("comment", from, to),
      callout,
      node("comment", source.indexOf("%%one"), source.indexOf("%%one") + 7),
      node("comment", source.indexOf("%%two"), source.indexOf("%%two") + 7),
    ],
    doc,
  );
  expect(spans.map((span) => span.node.kind)).toEqual(["comment", "callout"]);
  expect(spans[0].block).toBe(false);
});
it("collects non-overlapping block and inline ranges without replacing unrelated prose", () => {
  const text = "Intro $x$ text\n\n![img](p.png)\n\n| A |\n|---|\n| 1 |\n";
  const doc = Text.of(text.split("\n"));
  const math = node("math", 6, 9),
    image = node("image", 16, 29);
  image.to = text.indexOf("\n", 16);
  const table = node("table", text.indexOf("| A |"), text.length);
  const spans = collectRichSpans(
    [node("paragraph", 0, 14, [math]), image, table],
    doc,
  );
  expect(spans.map((span) => [span.node.kind, span.block])).toEqual([
    ["math", false],
    ["image", true],
    ["table", true],
  ]);
  expect(doc.sliceString(spans[2].from, spans[2].to)).toContain("| 1 |");
});
it("maps untouched previews, drops edited blocks immediately and rejects stale IPC ranges", () => {
  let state = EditorState.create({
    doc: "intro\n\n$x$\n\ntail",
    extensions: [history(), richPreviewState],
  });
  const original = state.doc;
  const spans = collectRichSpans([node("math", 7, 10)], state.doc);
  state = state.update({
    effects: parsedPreview.of({ doc: state.doc, spans }),
  }).state;
  state = state.update({ changes: { from: 0, insert: "new " } }).state;
  expect(state.field(richPreviewState).spans[0].from).toBe(11);
  state = state.update({
    effects: parsedPreview.of({ doc: original, spans }),
  }).state;
  expect(state.field(richPreviewState).spans[0].from).toBe(11);
  state = state.update({ changes: { from: 12, insert: "2" } }).state;
  expect(state.field(richPreviewState).spans).toEqual([]);
  expect(state.doc.toString()).toContain("$2x$");
});
it("preview effects preserve source bytes and the document undo history", () => {
  let state = EditorState.create({
    doc: "start\n\n$x$",
    extensions: [history(), richPreviewState],
  });
  state = state.update({
    changes: { from: 0, insert: "😀 " },
    userEvent: "input",
  }).state;
  const before = state.doc.toString();
  state = state.update({
    effects: parsedPreview.of({
      doc: state.doc,
      spans: collectRichSpans([node("math", 10, 13)], state.doc),
    }),
  }).state;
  expect(state.doc.toString()).toBe(before);
  undo({
    state,
    dispatch: (tr) => {
      state = tr.state;
    },
  });
  expect(state.doc.toString()).toBe("start\n\n$x$");
});

it.each(["photo.png", "Report.pdf", "Sound.wav", "Archive.zip", "Other.md"])(
  "keeps %s visible during label and adjacent typing, but removes deleted attachments",
  (target) => {
    const source = `![[${target}|Caption]]`;
    let state = EditorState.create({
      doc: source,
      extensions: [richPreviewState],
    });
    const image = {
      ...node("embed", 0, source.length),
      target,
      hasAlias: true,
    };
    state = state.update({
      effects: parsedPreview.of({
        doc: state.doc,
        spans: collectRichSpans([image], state.doc),
      }),
    }).state;
    state = state.update({
      changes: { from: source.indexOf("]]"), insert: " text" },
    }).state;
    expect(state.field(richPreviewState).spans).toHaveLength(1);
    state = state.update({
      changes: { from: state.doc.length, insert: " after image" },
    }).state;
    expect(state.field(richPreviewState).spans).toHaveLength(1);
    state = state.update({
      changes: { from: state.doc.length, insert: "\nNext line" },
    }).state;
    expect(state.field(richPreviewState).spans).toHaveLength(1);
    state = state.update({
      changes: { from: 0, to: state.doc.length, insert: "plain text" },
    }).state;
    expect(state.field(richPreviewState).spans).toHaveLength(0);
  },
);
