import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { EditorView } from "@codemirror/view";
import { redo, undo } from "@codemirror/commands";
import { afterEach, expect, it, vi } from "vitest";
import { NotePicker } from "../src/components/NotePicker";
import { MarkdownEditor } from "../src/editor/MarkdownEditor";
import {
  insertSelectionLink,
  startSelectionLink,
} from "../src/editor/selectionLink";
import type { SharedEditors } from "../src/editor/sharedViews";
import { api } from "../src/services/api";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

it("opens a recent note or an alias result from the keyboard", async () => {
  const dialog = HTMLDialogElement.prototype;
  Object.defineProperties(dialog, {
    showModal: {
      configurable: true,
      value(this: HTMLDialogElement) {
        this.setAttribute("open", "");
      },
    },
    close: {
      configurable: true,
      value(this: HTMLDialogElement) {
        this.removeAttribute("open");
      },
    },
  });
  const search = vi.spyOn(api, "linkSuggestions").mockResolvedValue([
    { path: "Проекты/План.md", alias: "План запуска", title: "Выпуск" },
    { path: "Планы.md", alias: null, title: "Планы" },
  ]);
  const choose = vi.fn(async () => false);
  render(
    <NotePicker
      vault="v"
      title="Быстрое открытие"
      recent={["Недавняя.md"]}
      refresh={0}
      onClose={vi.fn()}
      onChoose={choose}
    />,
  );
  const input = screen.getByRole("combobox");
  fireEvent.keyDown(input, { key: "Enter" });
  await waitFor(() => expect(choose).toHaveBeenCalledWith("Недавняя.md"));
  await waitFor(() => expect(input).not.toHaveProperty("readOnly", true));
  fireEvent.change(input, { target: { value: "план" } });
  await screen.findByText("План запуска");
  expect(search).toHaveBeenCalledWith("v", "план", true);
  fireEvent.keyDown(input, { key: "ArrowDown" });
  fireEvent.keyDown(input, { key: "ArrowUp" });
  fireEvent.keyDown(input, { key: "Enter" });
  await waitFor(() =>
    expect(choose).toHaveBeenLastCalledWith("Проекты/План.md"),
  );
});

it("shares content and undo across editors while mapping a pending link and each caret", async () => {
  const sharedEditors: SharedEditors = new Map();
  const publish = vi.fn();
  const draft = "вводная\r\nплан проекта\r\nвыводы";
  render(
    <>
      <MarkdownEditor
        content={draft}
        vaultId="v"
        path="Draft.md"
        sharedEditors={sharedEditors}
        onChange={publish}
        onSave={vi.fn()}
        focused={false}
      />
      <MarkdownEditor
        content={draft}
        vaultId="v"
        path="Draft.md"
        sharedEditors={sharedEditors}
        onChange={publish}
        onSave={vi.fn()}
        focused={false}
      />
    </>,
  );
  const [left, right] = screen
    .getAllByLabelText("Markdown-редактор")
    .map((element) => EditorView.findFromDOM(element)!);
  const line = left.state.doc.line(2);
  act(() => {
    left.dispatch({ selection: { anchor: line.from, head: line.to } });
    right.dispatch({ selection: { anchor: right.state.doc.line(3).to } });
    expect(startSelectionLink(left)).toBe("план проекта");
    right.dispatch({ changes: { from: 0, insert: "Новая " } });
  });
  expect(left.state.selection.main.from).toBe(line.from + "Новая ".length);
  vi.spyOn(api, "resolve").mockResolvedValue({
    path: "Проекты/План.md",
    status: "resolved",
    candidates: [],
    createPath: null,
  });
  await act(async () => {
    expect(
      await insertSelectionLink(
        left,
        "v",
        "Draft.md",
        "Проекты/План.md",
        () => true,
      ),
    ).toBe(true);
  });
  const linked = "Новая вводная\r\n[[Проекты/План|план проекта]]\r\nвыводы";
  expect(right.state.sliceDoc()).toBe(linked);
  expect(right.state.selection.main.head).toBe(right.state.doc.length);
  expect(publish).toHaveBeenCalledTimes(2);
  act(() => {
    expect(undo(right)).toBe(true);
  });
  expect(left.state.sliceDoc()).toBe("Новая " + draft);
  act(() => {
    expect(redo(left)).toBe(true);
  });
  expect(right.state.sliceDoc()).toBe(linked);
});

it("does not replace text when the original selection changed during lookup", async () => {
  render(
    <MarkdownEditor
      content="план"
      onChange={vi.fn()}
      onSave={vi.fn()}
      focused={false}
    />,
  );
  const view = EditorView.findFromDOM(
    screen.getByLabelText("Markdown-редактор"),
  )!;
  act(() => {
    view.dispatch({ selection: { anchor: 0, head: 4 } });
    startSelectionLink(view);
  });
  const target = {
    path: "План.md",
    status: "resolved",
    candidates: [],
    createPath: null,
  } as const;
  let resolve!: () => void;
  vi.spyOn(api, "resolve").mockReturnValue(
    new Promise((done) => {
      resolve = () => done({ ...target, candidates: [] });
    }),
  );
  const pending = insertSelectionLink(
    view,
    "v",
    "Draft.md",
    "План.md",
    () => true,
  );
  act(() => view.dispatch({ changes: { from: 1, to: 3, insert: "ока" } }));
  resolve();
  await expect(pending).rejects.toThrow("Выделенный текст изменился");
  expect(view.state.sliceDoc()).toBe("покан");
});
