import { afterEach, expect, it } from "vitest";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { markdown } from "@codemirror/lang-markdown";
import { ensureSyntaxTree, foldable } from "@codemirror/language";
import { history, undo } from "@codemirror/commands";
import { noteFolding } from "../src/editor/folding";
import { propertyEdit } from "../src/editor/properties";
import {
  expandTemplate,
  insertTemplate,
  templateChanges,
} from "../src/editor/templates";

let view: EditorView | undefined;
afterEach(() => {
  view?.destroy();
  view = undefined;
});
it("folds heading sections and nested list items without hiding the next peer", () => {
  const source =
    "# First\nBody\n## Child\nText\n# Next\n- Parent\n  - Child\n- Peer";
  const state = EditorState.create({
    doc: source,
    extensions: [markdown(), noteFolding],
  });
  ensureSyntaxTree(state, source.length, 100);
  expect(foldable(state, 0, 7)).toEqual({
    from: 7,
    to: source.indexOf("# Next") - 1,
  });
  const line = state.doc.line(6);
  const list = foldable(state, line.from, line.to);
  expect(list).toBeTruthy();
  expect(state.sliceDoc(list!.from, list!.to)).toContain("Child");
  expect(state.sliceDoc(list!.from, list!.to)).not.toContain("Peer");
});
it("renames a YAML key while preserving its value, comments, BOM and body", () => {
  const content =
    "\uFEFF---\n# Keep\nold: [one, two] # comment\nother: 12\n---\nBody 😀";
  const expected = "# Keep\nold: [one, two] # comment\nother: 12\n";
  const edit = propertyEdit(content, { key: "old", rename: "new" }, expected);
  const result =
    content.slice(0, edit.from) + edit.insert + content.slice(edit.to);
  expect(result).toBe(content.replace("old:", '"new":'));
  expect(() =>
    propertyEdit(content, { key: "old", rename: "other" }, expected),
  ).toThrow("уже существует");
  expect(() =>
    propertyEdit(content, { key: "old", rename: "changed" }, "stale"),
  ).toThrow("изменились");
});
it("expands portable template tokens and merges missing properties in one undo step", () => {
  const source = "\uFEFF---\n# Preserve\nproject: Existing\n---\nBody";
  const template = expandTemplate(
    "---\nproject: Template\ndate: '{{date}}'\n---\n## {{title}} {{date:DD.MM.YYYY}} {{time}}",
    "Note",
    new Date(2026, 9, 29, 12, 34),
  );
  view = new EditorView({
    state: EditorState.create({
      doc: source,
      selection: { anchor: source.length },
      extensions: [history()],
    }),
    parent: document.body,
  });
  insertTemplate(view, template);
  const result = view.state.sliceDoc();
  expect(result).toContain("project: Existing");
  expect(result).toContain("# Preserve");
  expect(result).toContain("2026-10-29");
  expect(result).toContain("## Note 29.10.2026 12:34");
  undo(view);
  expect(view.state.sliceDoc()).toBe(source);
});
it("rejects malformed template headers and insertion into existing frontmatter", () => {
  expect(() => templateChanges("Body", "---\nkey: broken", 0, 0)).toThrow(
    "не закрыт",
  );
  expect(() =>
    templateChanges(
      "---\nkey: value\n---\nBody",
      "---\nnew: yes\n---\nText",
      5,
      5,
    ),
  ).toThrow("ниже свойств");
});
it("accepts empty frontmatter and refuses unresolved template YAML aliases", () => {
  expect(templateChanges("Body", "---\n---\nText", 4, 4)).toEqual([
    { from: 4, to: 4, insert: "Text" },
  ]);
  expect(() =>
    templateChanges(
      "---\nkey: current\n---\nBody",
      "---\nkey: &ref old\nnext: *ref\n---\nText",
      26,
      26,
    ),
  ).toThrow("YAML");
});
