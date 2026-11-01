import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { EditorView } from "@codemirror/view";
import { undo, undoDepth } from "@codemirror/commands";
import { MarkdownEditor } from "../src/editor/MarkdownEditor";
import {
  defaultTypography,
  parseTypography,
  readTypography,
  typographyKey,
} from "../src/workspace/typography";
afterEach(() => {
  cleanup();
  localStorage.removeItem(typographyKey);
  vi.restoreAllMocks();
});
it("restores preferences and rejects malformed or out-of-range persisted values", () => {
  expect(parseTypography("{broken")).toEqual(defaultTypography);
  expect(
    parseTypography('{"fontSize":99,"lineHeight":"2","textWidth":200}'),
  ).toEqual(defaultTypography);
  localStorage.setItem(
    typographyKey,
    JSON.stringify({ fontSize: 20, lineHeight: 2, textWidth: 1000 }),
  );
  expect(readTypography()).toEqual({
    fontSize: 20,
    lineHeight: 2,
    textWidth: 1000,
  });
  vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
    throw Error("unavailable");
  });
  expect(readTypography()).toEqual(defaultTypography);
});
it("preserves the editor buffer, selection and undo when typography changes", () => {
  const props = { content: "Original", onChange: vi.fn(), onSave: vi.fn() };
  const { rerender } = render(
    <MarkdownEditor {...props} typography={defaultTypography} />,
  );
  const element = screen.getByRole("textbox", { name: "Markdown-редактор" });
  const view = EditorView.findFromDOM(element);
  if (!view) throw Error("Editor missing");
  act(() =>
    view.dispatch({
      changes: { from: 8, insert: " draft" },
      selection: { anchor: 3 },
    }),
  );
  rerender(
    <MarkdownEditor
      {...props}
      typography={{ fontSize: 22, lineHeight: 2.2, textWidth: 1000 }}
    />,
  );
  expect(EditorView.findFromDOM(element)).toBe(view);
  expect(view.state.doc.toString()).toBe("Original draft");
  expect(view.state.selection.main.anchor).toBe(3);
  expect(undoDepth(view.state)).toBe(1);
  act(() => {
    undo(view);
  });
  expect(view.state.doc.toString()).toBe("Original");
});
