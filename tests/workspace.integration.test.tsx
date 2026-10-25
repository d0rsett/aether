import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { api } from "../src/services/api";
import { useWorkspace, type Ask } from "../src/app/useWorkspace";

vi.mock("../src/services/api", () => ({
  desktop: true,
  errorMessage: (e: unknown) =>
    typeof e === "object" && e !== null && "code" in e
      ? String(e.code)
      : String(e),
  api: {
    restore: vi.fn(),
    choose: vi.fn(),
    vaults: vi.fn(),
    switchVault: vi.fn(),
    createVault: vi.fn(),
    read: vi.fn(),
    list: vi.fn(),
    previewRename: vi.fn(),
    save: vi.fn(),
    create: vi.fn(),
    mkdir: vi.fn(),
    renameDirectory: vi.fn(),
    trashDirectory: vi.fn(),
    renameState: vi.fn(),
    applyRename: vi.fn(),
    undoRename: vi.fn(),
    locateAnchor: vi.fn(),
    trash: vi.fn(),
    resolve: vi.fn(),
  },
}));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    onCloseRequested: async (
      handler: (event: { preventDefault: () => void }) => void,
    ) => {
      windowEvents.close = handler;
      return () => {
        windowEvents.close = null;
      };
    },
    destroy: windowEvents.destroy,
  }),
}));

const vault = { id: "vault", path: "C:/Заметки", name: "Заметки" };
const note = { path: "Привет.md", content: "на диске", revision: "r1" };
const windowEvents = vi.hoisted(() => ({
  close: null as ((event: { preventDefault: () => void }) => void) | null,
  destroy: vi.fn(),
}));
const ask: Ask = async (options) => options.initial ?? "";

beforeEach(() => {
  vi.clearAllMocks();
  windowEvents.close = null;
  localStorage.clear();
  vi.mocked(api.restore).mockResolvedValue(vault);
  vi.mocked(api.vaults).mockResolvedValue([vault]);
  vi.mocked(api.read).mockResolvedValue(note);
  vi.mocked(api.renameState).mockResolvedValue(null);
});

it("opens, edits and saves a Unicode note using the original revision", async () => {
  const { result } = renderHook(() => useWorkspace(ask));
  await waitFor(() => expect(result.current.vault?.id).toBe("vault"));
  await act(async () => result.current.open(note.path));
  act(() =>
    result.current.dispatch({
      type: "edit",
      path: note.path,
      content: "# Изменено",
    }),
  );
  vi.mocked(api.save).mockResolvedValue("r2");
  await act(async () => result.current.save());
  expect(api.save).toHaveBeenCalledWith(
    "vault",
    "Привет.md",
    "# Изменено",
    "r1",
  );
  expect(result.current.active?.savedContent).toBe("# Изменено");
  expect(result.current.active?.revision).toBe("r2");
});

it("keeps editor content after an external modification conflict", async () => {
  const { result } = renderHook(() => useWorkspace(ask));
  await waitFor(() => expect(result.current.vault).not.toBeNull());
  await act(async () => result.current.open(note.path));
  act(() =>
    result.current.dispatch({
      type: "edit",
      path: note.path,
      content: "мой текст",
    }),
  );
  vi.mocked(api.save).mockRejectedValue({ code: "Conflict" });
  await act(async () => result.current.save());
  expect(result.current.error).toContain("Conflict");
  expect(result.current.active?.content).toBe("мой текст");
  expect(result.current.active?.savedContent).toBe("на диске");
});

it("recovers a draft even if its original file was deleted externally", async () => {
  localStorage.setItem(
    "aether.workspace.v1:vault",
    JSON.stringify({
      paths: [note.path],
      active: note.path,
      drafts: { [note.path]: { content: "ценный черновик", revision: "r1" } },
    }),
  );
  vi.mocked(api.read).mockRejectedValue(new Error("file not found"));
  const { result } = renderHook(() => useWorkspace(ask));
  await waitFor(() =>
    expect(result.current.active?.content).toBe("ценный черновик"),
  );
  expect(result.current.active?.revision).toBe("r1");
  expect(result.current.error).toContain("file not found");
});

it("keeps unsaved content when a window close request is cancelled", async () => {
  const cancel = vi.fn(async () => null);
  const { result } = renderHook(() => useWorkspace(cancel));
  await waitFor(() => expect(result.current.vault).not.toBeNull());
  await act(async () => result.current.open(note.path));
  act(() =>
    result.current.dispatch({
      type: "edit",
      path: note.path,
      content: "черновик",
    }),
  );
  await waitFor(() => expect(windowEvents.close).not.toBeNull());
  const preventDefault = vi.fn();
  await act(async () => windowEvents.close?.({ preventDefault }));
  expect(preventDefault).toHaveBeenCalled();
  expect(cancel).toHaveBeenCalled();
  expect(windowEvents.destroy).not.toHaveBeenCalled();
  expect(result.current.active?.content).toBe("черновик");
});

it("persists the draft before destroying the window after an approved close", async () => {
  const { result } = renderHook(() => useWorkspace(ask));
  await waitFor(() => expect(result.current.vault).not.toBeNull());
  await act(async () => result.current.open(note.path));
  act(() =>
    result.current.dispatch({
      type: "edit",
      path: note.path,
      content: "резервный черновик",
    }),
  );
  await waitFor(() => expect(windowEvents.close).not.toBeNull());
  await act(async () => windowEvents.close?.({ preventDefault: vi.fn() }));
  await waitFor(() => expect(windowEvents.destroy).toHaveBeenCalledOnce());
  expect(localStorage.getItem("aether.workspace.v1:vault")).toContain(
    "резервный черновик",
  );
});

it("wiki navigation preserves an existing unsaved tab", async () => {
  const second = { path: "Вторая.md", content: "disk", revision: "second" };
  vi.mocked(api.read).mockResolvedValueOnce(note).mockResolvedValueOnce(second);
  vi.mocked(api.resolve).mockResolvedValue({
    status: "resolved",
    path: second.path,
    candidates: [],
    createPath: null,
  });
  const { result } = renderHook(() => useWorkspace(ask));
  await waitFor(() => expect(result.current.vault).not.toBeNull());
  await act(async () => result.current.open(note.path));
  await act(async () => result.current.open(second.path));
  act(() =>
    result.current.dispatch({
      type: "edit",
      path: second.path,
      content: "unsaved text",
    }),
  );
  await act(async () => result.current.open(note.path));
  await act(async () => result.current.openWiki(note.path, "Вторая"));
  expect(result.current.active?.content).toBe("unsaved text");
  expect(api.read).toHaveBeenCalledTimes(2);
});

it("does not create a missing wiki target when the prompt is cancelled", async () => {
  vi.mocked(api.resolve).mockResolvedValue({
    status: "missing",
    path: null,
    candidates: [],
    createPath: "Новая.md",
  });
  const { result } = renderHook(() => useWorkspace(async () => null));
  await waitFor(() => expect(result.current.vault).not.toBeNull());
  await act(async () => result.current.openWiki(note.path, "Новая"));
  expect(api.create).not.toHaveBeenCalled();
});

it("keeps the vault menu usable when the last folder cannot be restored", async () => {
  const other = { id: "available", name: "Работа", path: "C:/Работа" };
  vi.mocked(api.restore).mockRejectedValue(
    new Error("last folder unavailable"),
  );
  vi.mocked(api.vaults).mockResolvedValue([other]);
  const { result } = renderHook(() => useWorkspace(ask));
  await waitFor(() =>
    expect(result.current.error).toContain("last folder unavailable"),
  );
  expect(result.current.knownVaults).toEqual([other]);
  vi.mocked(api.switchVault).mockResolvedValue(other);
  await act(async () => result.current.switchVault(other.id));
  expect(result.current.vault?.id).toBe(other.id);
});

it("cancels a dirty vault switch, then keeps and restores its draft when switching back", async () => {
  const other = { id: "other", name: "Работа", path: "C:/Работа" };
  const confirm = vi.fn<Ask>(async () => null);
  vi.mocked(api.vaults).mockResolvedValue([vault, other]);
  const { result } = renderHook(() => useWorkspace(confirm));
  await waitFor(() => expect(result.current.busy).toBe(false));
  await act(async () => result.current.open(note.path));
  act(() =>
    result.current.dispatch({
      type: "edit",
      path: note.path,
      content: "ценный черновик",
    }),
  );
  await act(async () => result.current.switchVault(other.id));
  expect(api.switchVault).not.toHaveBeenCalled();
  expect(result.current.active?.content).toBe("ценный черновик");
  confirm.mockResolvedValue("");
  vi.mocked(api.switchVault).mockResolvedValue(other);
  await act(async () => result.current.switchVault(other.id));
  expect(result.current.vault?.id).toBe(other.id);
  expect(result.current.workspace.tabs).toHaveLength(0);
  expect(localStorage.getItem("aether.workspace.v1:vault")).toContain(
    "ценный черновик",
  );
  vi.mocked(api.switchVault).mockResolvedValue(vault);
  vi.mocked(api.read).mockResolvedValue(note);
  await act(async () => result.current.switchVault(vault.id));
  expect(result.current.active?.content).toBe("ценный черновик");
  expect(api.save).not.toHaveBeenCalled();
  vi.mocked(api.save).mockResolvedValue("saved");
  await act(async () => result.current.save());
  expect(api.save).toHaveBeenCalledWith(
    vault.id,
    note.path,
    "ценный черновик",
    note.revision,
  );
});

it("new-vault creation asks for a name, supports cancellation and rejects paths", async () => {
  const question = vi.fn<Ask>(async () => null);
  const { result } = renderHook(() => useWorkspace(question));
  await waitFor(() => expect(result.current.busy).toBe(false));
  await act(async () => result.current.createVault());
  expect(api.createVault).not.toHaveBeenCalled();
  question.mockResolvedValue("../escape");
  await act(async () => result.current.createVault());
  expect(api.createVault).not.toHaveBeenCalled();
  expect(result.current.error).toContain("имя папки без пути");
  question.mockResolvedValue("Проект");
  vi.mocked(api.createVault).mockResolvedValue({
    id: "new",
    name: "Проект",
    path: "C:/Проект",
  });
  await act(async () => result.current.createVault());
  expect(api.createVault).toHaveBeenCalledWith("Проект");
  expect(result.current.vault?.name).toBe("Проект");
});

it("locates anchors in the current dirty buffer and reports missing anchors without creating files", async () => {
  vi.mocked(api.resolve).mockResolvedValue({
    status: "resolved",
    path: note.path,
    candidates: [],
    createPath: null,
  });
  vi.mocked(api.locateAnchor).mockResolvedValue({ from: 8, to: 20, line: 3 });
  const { result } = renderHook(() => useWorkspace(ask));
  await waitFor(() => expect(result.current.busy).toBe(false));
  await act(async () => result.current.open(note.path));
  act(() =>
    result.current.dispatch({
      type: "edit",
      path: note.path,
      content: "dirty\n\n# Новый",
    }),
  );
  await act(async () => result.current.openWiki("other.md", "Привет#Новый"));
  expect(api.locateAnchor).toHaveBeenLastCalledWith(
    "vault",
    note.path,
    "dirty\n\n# Новый",
    "Новый",
  );
  expect(result.current.navigation?.from).toBe(8);
  vi.mocked(api.locateAnchor).mockRejectedValue(new Error("anchor missing"));
  await act(async () => result.current.openWiki("other.md", "Привет#Нет"));
  expect(result.current.error).toContain("anchor missing");
  expect(result.current.active?.content).toBe("dirty\n\n# Новый");
  expect(api.create).not.toHaveBeenCalled();
});

it("blocks a reviewed rename affecting a dirty tab and refreshes clean related tabs after applying", async () => {
  const ref = { path: "Ref.md", content: "[[Привет]]", revision: "ref1" };
  const preview = {
    token: "plan",
    from: note.path,
    to: "Новое.md",
    files: 2,
    links: 1,
    unresolved: 0,
    changes: [],
    hasMore: false,
    affectedOpenPaths: [note.path, ref.path],
  };
  const review = vi.fn(async () => preview);
  vi.mocked(api.read).mockImplementation(async (_id, path) =>
    path === ref.path ? ref : note,
  );
  const { result } = renderHook(() => useWorkspace(ask, review));
  await waitFor(() => expect(result.current.busy).toBe(false));
  await act(async () => result.current.open(ref.path));
  act(() =>
    result.current.dispatch({
      type: "edit",
      path: ref.path,
      content: "my draft",
    }),
  );
  await act(async () => result.current.open(note.path));
  await act(async () => result.current.rename());
  expect(api.applyRename).not.toHaveBeenCalled();
  expect(result.current.error).toContain("сохраните");
  act(() =>
    result.current.dispatch({ type: "replace", path: ref.path, note: ref }),
  );
  vi.mocked(api.applyRename).mockResolvedValue({
    from: note.path,
    note: { ...note, path: "Новое.md" },
  });
  vi.mocked(api.read).mockResolvedValue({
    ...ref,
    content: "[[Новое]]",
    revision: "ref2",
  });
  await act(async () => result.current.rename());
  expect(api.applyRename).toHaveBeenCalledWith("vault", "plan");
  expect(
    result.current.workspace.tabs.find((t) => t.path === ref.path)?.content,
  ).toBe("[[Новое]]");
  expect(result.current.active?.path).toBe("Новое.md");
});

it("loads pending recovery without writing files and refuses undo with affected dirty buffers", async () => {
  vi.mocked(api.renameState).mockResolvedValue({
    id: "journal",
    from: "Old.md",
    to: note.path,
    pending: true,
    affectedOpenPaths: [note.path],
  });
  const { result } = renderHook(() => useWorkspace(ask));
  await waitFor(() => expect(result.current.renameState?.pending).toBe(true));
  expect(api.undoRename).not.toHaveBeenCalled();
  await act(async () => result.current.open(note.path));
  act(() =>
    result.current.dispatch({
      type: "edit",
      path: note.path,
      content: "keep draft",
    }),
  );
  await act(async () => result.current.undoRename());
  expect(api.undoRename).not.toHaveBeenCalled();
  expect(result.current.active?.content).toBe("keep draft");
});

it("targets an inactive file for trash without discarding the active draft", async () => {
  const other = { ...note, path: "Другая.md", revision: "other1" };
  const confirm = vi.fn<Ask>().mockResolvedValue("yes");
  const { result } = renderHook(() => useWorkspace(confirm));
  await waitFor(() => expect(result.current.vault).toBeTruthy());
  await act(async () => result.current.open(note.path));
  act(() =>
    result.current.dispatch({
      type: "edit",
      path: note.path,
      content: "мой черновик",
    }),
  );
  vi.mocked(api.read).mockResolvedValue(other);
  vi.mocked(api.trash).mockResolvedValue(".aether/trash/Другая.md");
  await act(async () => result.current.remove(other.path));
  expect(api.trash).toHaveBeenCalledWith(vault.id, other.path, "other1");
  expect(result.current.active?.path).toBe(note.path);
  expect(result.current.active?.content).toBe("мой черновик");
  expect(api.save).not.toHaveBeenCalled();
});
it("creates inside the context folder without changing the default folder", async () => {
  const prompt = vi.fn<Ask>().mockResolvedValue(null);
  const { result } = renderHook(() => useWorkspace(prompt));
  await waitFor(() => expect(result.current.vault).toBeTruthy());
  act(() => result.current.setFolder("Личное"));
  await act(async () => result.current.create(false, false, "Проект"));
  expect(prompt).toHaveBeenCalledWith(
    expect.objectContaining({ initial: "Проект/Без названия.md" }),
  );
  expect(result.current.folder).toBe("Личное");
  expect(api.create).not.toHaveBeenCalled();
});

it("creates a new note without a prompt, avoiding existing names and races", async () => {
  const question = vi.fn<Ask>();
  const { result } = renderHook(() => useWorkspace(question));
  await waitFor(() => expect(result.current.busy).toBe(false));
  act(() => result.current.setFolder("Проект"));
  vi.mocked(api.list).mockResolvedValue([
    { name: "Новая заметка.md", path: "Новая заметка.md", isDirectory: false },
  ]);
  vi.mocked(api.create)
    .mockRejectedValueOnce({ code: "AlreadyExists" })
    .mockResolvedValueOnce({
      ...note,
      path: "Новая заметка 2.md",
      content: "",
    });
  await act(async () => result.current.createQuick());
  expect(api.list).toHaveBeenCalledWith(vault.id, "");
  expect(question).not.toHaveBeenCalled();
  expect(api.create).toHaveBeenNthCalledWith(1, vault.id, "Новая заметка 1.md");
  expect(api.create).toHaveBeenNthCalledWith(2, vault.id, "Новая заметка 2.md");
  expect(result.current.active?.path).toBe("Новая заметка 2.md");
  expect(result.current.titleFocus?.path).toBe("Новая заметка 2.md");
});

it("renames inline without review after preserving open drafts and refreshes the workspace", async () => {
  const review = vi.fn();
  const { result } = renderHook(() => useWorkspace(ask, review));
  await waitFor(() => expect(result.current.busy).toBe(false));
  await act(async () => result.current.open(note.path));
  act(() =>
    result.current.dispatch({
      type: "edit",
      path: note.path,
      content: "мой текст",
    }),
  );
  vi.mocked(api.save).mockResolvedValue("saved");
  vi.mocked(api.previewRename).mockResolvedValue({
    token: "inline-plan",
    from: note.path,
    to: "Новая.md",
    files: 1,
    links: 1,
    unresolved: 0,
    changes: [],
    hasMore: false,
    affectedOpenPaths: [note.path],
  });
  vi.mocked(api.applyRename).mockResolvedValue({
    from: note.path,
    note: {
      ...note,
      path: "Новая.md",
      content: "мой текст",
      revision: "renamed",
    },
  });
  await act(async () => result.current.rename(note.path, "Новая.md"));
  expect(review).not.toHaveBeenCalled();
  expect(api.save).toHaveBeenCalledWith(
    vault.id,
    note.path,
    "мой текст",
    note.revision,
  );
  expect(api.previewRename).toHaveBeenCalledWith(
    vault.id,
    note.path,
    "Новая.md",
    "saved",
    [note.path],
  );
  expect(api.applyRename).toHaveBeenCalledWith(vault.id, "inline-plan");
  expect(result.current.active?.path).toBe("Новая.md");
  expect(result.current.active?.content).toBe("мой текст");
  expect(result.current.refresh).toBeGreaterThan(0);
  expect(result.current.notice).toBe("");
});

it("does not rename when a draft conflicts with an external change", async () => {
  const { result } = renderHook(() => useWorkspace(ask));
  await waitFor(() => expect(result.current.busy).toBe(false));
  await act(async () => result.current.open(note.path));
  act(() =>
    result.current.dispatch({
      type: "edit",
      path: note.path,
      content: "черновик",
    }),
  );
  vi.mocked(api.save).mockRejectedValueOnce({ code: "Conflict" });
  await act(async () => result.current.rename(note.path, "Новое имя.md"));
  expect(api.previewRename).not.toHaveBeenCalled();
  expect(api.applyRename).not.toHaveBeenCalled();
  expect(result.current.active?.content).toBe("черновик");
});

it("creates a uniquely named folder inside its context parent with no dialog", async () => {
  const question = vi.fn<Ask>();
  const { result } = renderHook(() => useWorkspace(question));
  await waitFor(() => expect(result.current.busy).toBe(false));
  vi.mocked(api.list).mockResolvedValue([
    { name: "Новая папка", path: "Проект/Новая папка", isDirectory: true },
  ]);
  vi.mocked(api.mkdir)
    .mockRejectedValueOnce({ code: "AlreadyExists" })
    .mockResolvedValueOnce(undefined);
  await act(async () => result.current.createFolderQuick("Проект"));
  expect(question).not.toHaveBeenCalled();
  expect(api.list).toHaveBeenCalledWith(vault.id, "Проект");
  expect(api.mkdir).toHaveBeenNthCalledWith(
    1,
    vault.id,
    "Проект/Новая папка 1",
  );
  expect(api.mkdir).toHaveBeenNthCalledWith(
    2,
    vault.id,
    "Проект/Новая папка 2",
  );
  expect(result.current.entryEdit).toBe("Проект/Новая папка 2");
  vi.mocked(api.renameDirectory).mockResolvedValue({
    from: "Проект/Новая папка 2",
    directory: true,
    note: { path: "Проект/Планы", content: "", revision: "" },
  });
  await act(async () => {
    await result.current.renameEntry("Проект/Новая папка 2", "Планы", true);
  });
  expect(api.renameDirectory).toHaveBeenCalledWith(
    vault.id,
    "Проект/Новая папка 2",
    "Планы",
  );
  expect(result.current.folder).toBe("Проект/Планы");
  expect(result.current.entryEdit).toBeNull();
});

it("retains inline editing after a folder rename fails", async () => {
  const { result } = renderHook(() => useWorkspace(ask));
  await waitFor(() => expect(result.current.busy).toBe(false));
  act(() => result.current.setEntryEdit("Новая папка"));
  vi.mocked(api.renameDirectory).mockRejectedValueOnce({
    code: "AlreadyExists",
  });
  let success = true;
  await act(async () => {
    success = await result.current.renameEntry(
      "Новая папка",
      "Существующая",
      true,
    );
  });
  expect(success).toBe(false);
  expect(result.current.entryEdit).toBe("Новая папка");
});

it("trashes a folder after confirmation, preserves drafts and closes only its tabs", async () => {
  const question = vi.fn<Ask>().mockResolvedValue("yes");
  const { result } = renderHook(() => useWorkspace(question));
  await waitFor(() => expect(result.current.busy).toBe(false));
  vi.mocked(api.read).mockImplementation(async (_id, path) => ({
    ...note,
    path,
  }));
  await act(async () => result.current.open("Папка/Вложено.md"));
  act(() =>
    result.current.dispatch({
      type: "edit",
      path: "Папка/Вложено.md",
      content: "черновик",
    }),
  );
  await act(async () => result.current.open("Оставить.md"));
  vi.mocked(api.save).mockResolvedValue("saved");
  vi.mocked(api.trashDirectory).mockResolvedValue({ trash: "trash/folder" });
  await act(async () => {
    await result.current.removeDirectory("Папка");
  });
  expect(api.save).toHaveBeenCalledWith(
    vault.id,
    "Папка/Вложено.md",
    "черновик",
    note.revision,
  );
  expect(api.trashDirectory).toHaveBeenCalledWith(vault.id, "Папка");
  expect(result.current.workspace.tabs.map((tab) => tab.path)).toEqual([
    "Оставить.md",
  ]);
});

it("does not save or trash a folder when confirmation is cancelled", async () => {
  const question = vi.fn<Ask>().mockResolvedValue(null);
  const { result } = renderHook(() => useWorkspace(question));
  await waitFor(() => expect(result.current.busy).toBe(false));
  await act(async () => {
    await result.current.removeDirectory("Папка");
  });
  expect(api.save).not.toHaveBeenCalled();
  expect(api.trashDirectory).not.toHaveBeenCalled();
});
