import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { api, type RenderDocument, type RenderNode } from "../src/services/api";
import { NotePreviews } from "../src/services/notePreviews";
import { NoteEmbed } from "../src/reading/NoteEmbed";
import type { RenderContext } from "../src/reading/ReadingView";

const node = (
  kind: string,
  text = "",
  target = "",
  children: RenderNode[] = [],
): RenderNode => ({
  kind,
  text,
  target,
  children,
  from: 0,
  to: 3,
  level: 0,
  line: 1,
  endLine: 1,
});
const document = (...nodes: RenderNode[]): RenderDocument => ({
  nodes,
  warning: null,
});
const tab = (path: string, content: string) => ({
  path,
  content,
  savedContent: content,
  revision: "r",
});
let store: NotePreviews;
let context: RenderContext;
beforeEach(() => {
  store = new NotePreviews();
  store.update("v", [], 0);
  context = {
    vaultId: "v",
    path: "Main.md",
    previews: store,
    onWiki: vi.fn(),
    onNavigate: vi.fn(),
    onError: vi.fn(),
  };
  vi.spyOn(api, "resolve").mockResolvedValue({
    status: "resolved",
    path: "Notes/Child.md",
    candidates: [],
    createPath: null,
  });
  vi.spyOn(api, "read").mockResolvedValue({
    path: "Notes/Child.md",
    content: "Disk text",
    revision: "r",
  });
  vi.spyOn(api, "renderFragment").mockImplementation(
    async (_vault, _path, content) => document(node("text", content)),
  );
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

it("uses live buffers and updates them without reading or writing the original file", async () => {
  store.update("v", [tab("Notes/Child.md", "Unsaved draft")], 0);
  render(<NoteEmbed target="Child#Section" label="Child" context={context} />);
  expect(await screen.findByText("Unsaved draft")).toBeTruthy();
  expect(api.read).not.toHaveBeenCalled();
  expect(api.renderFragment).toHaveBeenCalledWith(
    "v",
    "Notes/Child.md",
    "Unsaved draft",
    "Section",
  );
  act(() => store.update("v", [tab("Notes/Child.md", "Changed draft")], 0));
  expect(screen.queryByText("Unsaved draft")).toBeNull();
  expect(await screen.findByText("Changed draft")).toBeTruthy();
});

it("uses the embedded note as link origin and keeps embedded tasks read-only", async () => {
  vi.mocked(api.renderFragment).mockResolvedValue(
    document(
      node("wiki", "", "../Sibling", [node("text", "Go to sibling")]),
      node("task", "[ ]"),
    ),
  );
  render(
    <NoteEmbed
      target="Child"
      label="Alias"
      context={{ ...context, onTask: vi.fn() }}
    />,
  );
  fireEvent.click(await screen.findByRole("link", { name: "Go to sibling" }));
  expect(context.onNavigate).toHaveBeenCalledWith(
    "Notes/Child.md",
    "../Sibling",
  );
  expect(screen.getByRole("checkbox").hasAttribute("disabled")).toBe(true);
  fireEvent.click(
    screen.getByRole("button", { name: "Открыть оригинал: Alias" }),
  );
  expect(context.onWiki).toHaveBeenCalledWith("Child");
});

it("stops circular embeds after resolving their actual paths", async () => {
  vi.mocked(api.resolve).mockResolvedValue({
    status: "resolved",
    path: "Main.md",
    candidates: [],
    createPath: null,
  });
  render(<NoteEmbed target="./Main.md" label="Self" context={context} />);
  expect(await screen.findByText(/Циклическое встраивание/)).toBeTruthy();
  expect(api.read).not.toHaveBeenCalled();
  expect(api.renderFragment).not.toHaveBeenCalled();
});

it("allows a section from the same unsaved note", async () => {
  store.update("v", [tab("Main.md", "Current text")], 0);
  vi.mocked(api.resolve).mockResolvedValue({
    status: "resolved",
    path: "Main.md",
    candidates: [],
    createPath: null,
  });
  render(<NoteEmbed target="#Part" label="Part" context={context} />);
  expect(await screen.findByText("Current text")).toBeTruthy();
  expect(api.renderFragment).toHaveBeenCalledWith(
    "v",
    "Main.md",
    "Current text",
    "Part",
  );
});

it("does not apply an old read after the target changes", async () => {
  let complete:
    | ((value: { path: string; content: string; revision: string }) => void)
    | undefined;
  vi.mocked(api.read).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        complete = resolve;
      }),
  );
  const { rerender } = render(
    <NoteEmbed target="Old" label="Old" context={context} />,
  );
  await vi.waitFor(() => expect(api.read).toHaveBeenCalledOnce());
  rerender(<NoteEmbed target="New" label="New" context={context} />);
  expect(await screen.findByText("Disk text")).toBeTruthy();
  await act(async () =>
    complete?.({
      path: "Notes/Child.md",
      content: "Stale text",
      revision: "old",
    }),
  );
  expect(screen.queryByText("Stale text")).toBeNull();
});

it("refreshes closed notes on disk changes and offers a retry for ambiguous paths", async () => {
  vi.mocked(api.resolve).mockResolvedValueOnce({
    status: "ambiguous",
    path: null,
    candidates: ["A/Child.md", "B/Child.md"],
    createPath: null,
  });
  render(<NoteEmbed target="Child" label="Child" context={context} />);
  expect(await screen.findByText(/Найдено несколько заметок/)).toBeTruthy();
  expect(api.read).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Повторить" }));
  expect(await screen.findByText("Disk text")).toBeTruthy();
  vi.mocked(api.read).mockResolvedValue({
    path: "Notes/Child.md",
    content: "External update",
    revision: "new",
  });
  act(() => store.update("v", [], 1));
  expect(await screen.findByText("External update")).toBeTruthy();
});

it("resolves Markdown embed paths through the shared document-link rules", async () => {
  vi.spyOn(api, "documentLink").mockResolvedValue("Notes/Child.md#Part");
  render(
    <NoteEmbed
      target="../Notes/Child.md#Part"
      label="Markdown"
      wiki={false}
      context={context}
    />,
  );
  expect(await screen.findByText("Disk text")).toBeTruthy();
  expect(api.documentLink).toHaveBeenCalledWith(
    "v",
    "Main.md",
    "../Notes/Child.md#Part",
  );
  expect(api.resolve).toHaveBeenCalledWith(
    "v",
    "Main.md",
    "Notes/Child.md#Part",
  );
});

it("bounds deep nesting before issuing requests", async () => {
  render(
    <NoteEmbed
      target="Child"
      label="Child"
      context={{ ...context, embedChain: ["A#", "B#", "C#", "D#", "E#"] }}
    />,
  );
  expect(await screen.findByText(/Достигнута глубина вложений/)).toBeTruthy();
  expect(api.resolve).not.toHaveBeenCalled();
});

it("offers recovery when the workspace has reached its active embed limit", async () => {
  const releases = Array.from({ length: 48 }, () => store.acquire());
  render(<NoteEmbed target="Child" label="Child" context={context} />);
  expect(
    await screen.findByText(/Слишком много вложенных заметок/),
  ).toBeTruthy();
  expect(api.resolve).not.toHaveBeenCalled();
  releases[0]?.();
  fireEvent.click(screen.getByRole("button", { name: "Повторить" }));
  expect(await screen.findByText("Disk text")).toBeTruthy();
});
