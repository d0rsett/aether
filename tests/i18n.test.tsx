import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { EditorView } from "@codemirror/view";
import { undo, undoDepth } from "@codemirror/commands";
import { t, setLocale, getLocale } from "../src/i18n";
import { MarkdownEditor } from "../src/editor/MarkdownEditor";
import { FormattingToolbar } from "../src/components/FormattingToolbar";
import { errorMessage } from "../src/services/api";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  act(() => {
    setLocale("ru");
  });
  localStorage.removeItem("aether.ui.language");
});
it("translates UI messages while preserving interpolated note names", () => {
  setLocale("en");
  expect(t("Создать хранилище")).toBe("Create vault");
  const name = "Мои заметки";
  expect(t`Закрыть ${name}`).toBe("Close Мои заметки");
  expect(
    errorMessage({
      code: "InvalidPath",
      message: "Заголовок «Мой раздел» не найден в заметке.",
    }),
  ).toBe("Heading “Мой раздел” was not found in the note.");
  setLocale("ru");
  expect(t("Create vault")).toBe("Создать хранилище");
});
it("keeps the same editor, text, selection and undo history when switching languages", () => {
  const source = "# Русская заметка\nСписок";
  render(
    <MarkdownEditor content={source} onChange={vi.fn()} onSave={vi.fn()} />,
  );
  const element = screen.getByRole("textbox", { name: "Markdown-редактор" });
  const view = EditorView.findFromDOM(element);
  if (!view) throw new Error("Editor not mounted");
  act(() =>
    view.dispatch({
      changes: { from: view.state.doc.length, insert: " draft" },
      selection: { anchor: 4 },
    }),
  );
  expect(undoDepth(view.state)).toBe(1);
  act(() => {
    setLocale("en");
  });
  expect(screen.getByRole("textbox", { name: "Markdown editor" })).toBe(
    element,
  );
  expect(view.state.sliceDoc()).toBe(source + " draft");
  expect(view.state.selection.main.anchor).toBe(4);
  expect(undoDepth(view.state)).toBe(1);
  act(() => {
    undo(view);
  });
  expect(view.state.sliceDoc()).toBe(source);
});
it("translates toolbar constants and persists a language preference", () => {
  render(
    <FormattingToolbar disabled={false} onFormat={vi.fn()} onClose={vi.fn()} />,
  );
  act(() => {
    setLocale("en");
  });
  expect(screen.getByRole("button", { name: "Bold" })).toBeTruthy();
  expect(screen.getByRole("group", { name: "Text styles" })).toBeTruthy();
  expect(localStorage.getItem("aether.ui.language")).toBe("en");
  expect(document.documentElement.lang).toBe("en");
});
it("keeps language switching available when preference storage fails", () => {
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw new Error("storage unavailable");
  });
  expect(setLocale("en")).toBe(false);
  expect(getLocale()).toBe("en");
});
