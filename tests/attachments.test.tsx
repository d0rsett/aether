import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { EditorView } from "@codemirror/view";
import { undo } from "@codemirror/commands";
import { MarkdownEditor } from "../src/editor/MarkdownEditor";
import { api } from "../src/services/api";

vi.mock("../src/services/api", () => ({
  api: { importAttachments: vi.fn(), attachmentLinks: vi.fn() },
  errorMessage: String,
}));
afterEach(cleanup);
beforeEach(() => vi.clearAllMocks());
const image = () =>
  new File([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])], "image.png", {
    type: "image/png",
  });
function paste(view: EditorView, files: File[]) {
  const event = new Event("paste", { bubbles: true, cancelable: true });
  Object.defineProperty(event, "clipboardData", { value: { files } });
  act(() => {
    view.contentDOM.dispatchEvent(event);
  });
}
function setup(onError = vi.fn()) {
  render(
    <MarkdownEditor
      content="AAA BBB"
      vaultId="vault"
      path="Note.md"
      onSave={vi.fn()}
      onChange={vi.fn()}
      onError={onError}
    />,
  );
  return EditorView.findFromDOM(
    screen.getByRole("textbox", { name: "Markdown-редактор" }),
  )!;
}
it("pastes a named image in the root at the mapped selection and supports one-step undo", async () => {
  let finish!: (value: { path: string; link: string }[]) => void;
  vi.mocked(api.importAttachments).mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const view = setup();
  act(() => {
    view.dispatch({ selection: { anchor: 4, head: 7 } });
  });
  paste(view, [image()]);
  await waitFor(() => expect(api.importAttachments).toHaveBeenCalledOnce());
  expect(vi.mocked(api.importAttachments).mock.calls[0][2][0].name).toBe(
    "Новое изображение.png",
  );
  expect(vi.mocked(api.importAttachments).mock.calls[0][3]).toBe(true);
  act(() => {
    view.dispatch({ changes: { from: 0, insert: "X" }, userEvent: "input" });
  });
  await act(async () =>
    finish([{ path: "Media/pic.png", link: "![[pic.png]]" }]),
  );
  expect(view.state.sliceDoc()).toBe("XAAA ![[pic.png]]");
  act(() => {
    undo(view);
  });
  expect(view.state.sliceDoc()).toBe("XAAA BBB");
});
it("preserves edits made inside the selection while an attachment is copied", async () => {
  let finish!: (value: { path: string; link: string }[]) => void;
  vi.mocked(api.importAttachments).mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const view = setup();
  act(() => {
    view.dispatch({ selection: { anchor: 4, head: 7 } });
  });
  paste(view, [image()]);
  await waitFor(() => expect(api.importAttachments).toHaveBeenCalledOnce());
  act(() => {
    view.dispatch({ changes: { from: 4, to: 7, insert: "new text" } });
  });
  await act(async () => finish([{ path: "pic.png", link: "![[pic.png]]" }]));
  expect(view.state.sliceDoc()).toBe("AAA new text![[pic.png]]");
});
it("keeps the selected text on failure and rejects oversized images before IPC", async () => {
  const onError = vi.fn();
  vi.mocked(api.importAttachments).mockRejectedValue(
    new Error("Vault changed"),
  );
  const view = setup(onError);
  act(() => {
    view.dispatch({ selection: { anchor: 4, head: 7 } });
  });
  paste(view, [image()]);
  await waitFor(() => expect(onError).toHaveBeenCalled());
  expect(view.state.sliceDoc()).toBe("AAA BBB");
  vi.mocked(api.importAttachments).mockClear();
  onError.mockClear();
  paste(view, [
    new File([new Uint8Array(8 * 1024 * 1024 + 1)], "huge.png", {
      type: "image/png",
    }),
  ]);
  await waitFor(() => expect(onError).toHaveBeenCalled());
  expect(api.importAttachments).not.toHaveBeenCalled();
  expect(view.state.sliceDoc()).toBe("AAA BBB");
});
