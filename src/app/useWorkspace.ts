import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import {
  api,
  desktop,
  errorMessage,
  type Note,
  type VaultInfo,
  type AnchorLocation,
  type RenameApplied,
  type RenameState,
} from "../services/api";
import type { ReviewRename } from "../components/RenameDialog";
import type { RequestVault } from "../components/CreateVaultDialog";
import { dirty, initialWorkspace, workspaceReducer } from "../workspace/model";
import { readWorkspace, writeWorkspace } from "../workspace/storage";

export interface Question {
  title: string;
  description?: string;
  initial?: string;
  label?: string;
  dangerous?: boolean;
}
export type Ask = (question: Question) => Promise<string | null>;

export function useWorkspace(
  ask: Ask,
  reviewRename?: ReviewRename,
  requestVault?: RequestVault,
) {
  const [vault, setVault] = useState<VaultInfo | null>(null);
  const [knownVaults, setKnownVaults] = useState<VaultInfo[]>([]);
  const [workspace, dispatch] = useReducer(workspaceReducer, initialWorkspace);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [refresh, setRefresh] = useState(0);
  const [folder, setFolder] = useState("");
  const [entryEdit, setEntryEdit] = useState<string | null>(null);
  const [renameState, setRenameState] = useState<RenameState | null>(null);
  const [navigation, setNavigation] = useState<
    (AnchorLocation & { path: string; id: number }) | null
  >(null);
  const [titleFocus, setTitleFocus] = useState<{
    path: string;
    id: number;
  } | null>(null);
  const navigationId = useRef(0);
  const ref = useRef({ workspace, vault });
  ref.current = { workspace, vault };
  const running = useRef(false);
  const initialized = useRef(false);
  const active = workspace.tabs.find((t) => t.path === workspace.active);

  const task = useCallback(async (action: () => Promise<void>) => {
    if (running.current) return false;
    running.current = true;
    setBusy(true);
    setError("");
    try {
      await action();
      return true;
    } catch (e) {
      setError(errorMessage(e));
      return false;
    } finally {
      running.current = false;
      setBusy(false);
    }
  }, []);

  const persist = useCallback(() => {
    const current = ref.current;
    if (current.vault) {
      try {
        writeWorkspace(current.vault.id, current.workspace);
      } catch {
        setError(
          "Не удалось сохранить резервный черновик: локальное хранилище заполнено или недоступно. Сохраните заметку на диск (Ctrl+S).",
        );
        return false;
      }
    }
    return true;
  }, []);

  const loadVault = useCallback(async (next: VaultInfo) => {
    dispatch({ type: "reset" });
    setVault(next);
    setFolder("");
    setEntryEdit(null);
    setNavigation(null);
    setRenameState(null);
    const stored = readWorkspace(next.id);
    let recovered = 0;
    const failed: string[] = [];
    for (const path of stored.paths) {
      try {
        const note = await api.read(next.id, path);
        const draft = stored.drafts[path];
        dispatch({
          type: "open",
          note:
            draft && draft.content !== note.content
              ? { ...note, revision: draft.revision }
              : note,
        });
        if (draft && draft.content !== note.content) {
          dispatch({ type: "edit", path, content: draft.content });
          recovered++;
        }
      } catch (e) {
        failed.push(`${path}: ${errorMessage(e)}`);
        const draft = stored.drafts[path];
        if (draft) {
          dispatch({
            type: "open",
            note: { path, content: "", revision: draft.revision },
          });
          dispatch({ type: "edit", path, content: draft.content });
          recovered++;
        }
      }
    }
    if (
      stored.active &&
      stored.paths.includes(stored.active) &&
      !failed.some((f) => f.startsWith(`${stored.active}:`))
    )
      dispatch({ type: "activate", path: stored.active });
    if (recovered)
      setNotice(
        `Восстановлены несохранённые черновики: ${recovered}. Проверьте текст и сохраните его.`,
      );
    if (failed.length)
      setError(
        `Не удалось прочитать файлы. ${failed.join(" · ")} Доступные черновики открыты в редакторе; их можно сохранить как копии.`,
      );
    setRefresh((n) => n + 1);
    try {
      setRenameState(await api.renameState(next.id, stored.paths));
    } catch (e) {
      setError(errorMessage(e));
    }
    try {
      setKnownVaults(await api.vaults());
    } catch (e) {
      setError(errorMessage(e));
    }
  }, []);

  useEffect(() => {
    if (!desktop || initialized.current) return;
    initialized.current = true;
    void task(async () => {
      setKnownVaults(await api.vaults());
      const next = await api.restore();
      if (next) await loadVault(next);
    });
  }, [task, loadVault]);

  useEffect(() => {
    if (busy) return;
    const timer = window.setTimeout(persist, 700);
    return () => window.clearTimeout(timer);
  }, [workspace, vault, busy, persist]);

  useEffect(() => {
    const handler = (event: BeforeUnloadEvent) => {
      persist();
      if (ref.current.workspace.tabs.some(dirty)) {
        event.preventDefault();
      }
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [persist]);

  useEffect(() => {
    if (!desktop) return;
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void import("@tauri-apps/api/window")
      .then(async ({ getCurrentWindow }) => {
        const window = getCurrentWindow();
        const cleanup = await window.onCloseRequested((event) => {
          event.preventDefault();
          if (running.current) return;
          void (async () => {
            if (
              ref.current.workspace.tabs.some(dirty) &&
              (await ask({
                title: "Закрыть приложение?",
                description:
                  "Есть несохранённые изменения. Черновики будут сохранены для восстановления, исходные файлы останутся без изменений.",
                label: "Закрыть",
              })) === null
            )
              return;
            if (!persist()) return;
            await window.destroy();
          })().catch((e) => setError(errorMessage(e)));
        });
        if (disposed) cleanup();
        else unlisten = cleanup;
      })
      .catch((e) => setError(errorMessage(e)));
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [ask, persist]);

  const changeVault = (select: () => Promise<VaultInfo | null>) =>
    task(async () => {
      if (!desktop) {
        setError(
          "Выбор локальной папки доступен в desktop-приложении. Запустите npm run tauri dev.",
        );
        return;
      }
      if (
        ref.current.workspace.tabs.some(dirty) &&
        (await ask({
          title: "Сменить хранилище?",
          description:
            "Несохранённые изменения останутся в резервных черновиках этого хранилища.",
          label: "Продолжить",
        })) === null
      )
        return;
      if (!persist()) return;
      const next = await select();
      if (next) await loadVault(next);
    });
  const choose = () => changeVault(() => api.choose());
  const switchVault = (id: string) => {
    if (ref.current.vault?.id === id) return Promise.resolve();
    return changeVault(() => api.switchVault(id));
  };
  const createVault = () =>
    changeVault(async () => {
      const options = await requestVault?.();
      if (!options) return null;
      if (!options.name.trim() || /[\\/]/.test(options.name))
        throw new Error("Введите имя папки без пути.");
      return api.createVault(options.name.trim(), options.parent.trim());
    });

  const open = (path: string) =>
    task(async () => {
      const current = ref.current;
      if (!current.vault) return;
      if (current.workspace.tabs.some((t) => t.path === path)) {
        dispatch({ type: "activate", path });
        return;
      }
      const note = await api.read(current.vault.id, path);
      dispatch({ type: "open", note });
    });

  const save = () =>
    task(async () => {
      const { vault: current, workspace: state } = ref.current;
      const tab = state.tabs.find((t) => t.path === state.active);
      if (!current || !tab || !dirty(tab)) return;
      const revision = await api.save(
        current.id,
        tab.path,
        tab.content,
        tab.revision,
      );
      dispatch({
        type: "saved",
        path: tab.path,
        content: tab.content,
        revision,
      });
      setNotice("Изменения сохранены на диск.");
    });

  const close = (path: string) =>
    task(async () => {
      const tab = ref.current.workspace.tabs.find((t) => t.path === path);
      if (
        tab &&
        dirty(tab) &&
        (await ask({
          title: "Закрыть несохранённую заметку?",
          description:
            "Изменения этой вкладки будут отброшены. Чтобы сохранить их, отмените действие и нажмите Ctrl+S.",
          label: "Отбросить изменения",
          dangerous: true,
        })) === null
      )
        return;
      dispatch({ type: "close", path });
    });

  const create = (directory = false, copy = false, parent = folder) =>
    task(async () => {
      const current = ref.current.vault;
      if (!current) return;
      const tab = ref.current.workspace.tabs.find(
        (t) => t.path === ref.current.workspace.active,
      );
      const prefix = parent ? `${parent}/` : "";
      const name = await ask({
        title: directory
          ? "Новая папка"
          : copy
            ? "Сохранить копию"
            : "Новая заметка",
        description:
          "Путь относительно хранилища. Родительская папка должна существовать.",
        initial: directory
          ? `${prefix}Новая папка`
          : `${prefix}${copy ? "Копия" : "Без названия"}.md`,
        label: "Создать",
      });
      if (name === null) return;
      if (!name.trim()) throw new Error("Укажите имя.");
      if (directory) {
        await api.mkdir(current.id, name.trim());
      } else {
        const note = await api.create(
          current.id,
          name.trim(),
          copy ? (tab?.content ?? "") : "",
        );
        dispatch({ type: "open", note });
      }
      setRefresh((n) => n + 1);
    });

  const createFolderQuick = (parent = "") =>
    task(async () => {
      const current = ref.current.vault;
      if (!current) return;
      const entries = await api.list(current.id, parent);
      const used = new Set(entries.map((entry) => entry.name.toLowerCase()));
      for (let index = 0; index < 10000; index++) {
        const name = `Новая папка${index ? ` ${index}` : ""}`;
        if (used.has(name.toLowerCase())) continue;
        const path = (parent ? `${parent}/` : "") + name;
        try {
          await api.mkdir(current.id, path);
        } catch (error) {
          if (
            typeof error === "object" &&
            error !== null &&
            "code" in error &&
            error.code === "AlreadyExists"
          )
            continue;
          throw error;
        }
        setFolder(path);
        setEntryEdit(path);
        setRefresh((n) => n + 1);
        return;
      }
      throw new Error("Не удалось подобрать свободное имя папки.");
    });

  const editTitle = (path = ref.current.workspace.active) =>
    task(async () => {
      const current = ref.current.vault;
      if (!current || !path) return;
      if (ref.current.workspace.tabs.some((tab) => tab.path === path))
        dispatch({ type: "activate", path });
      else dispatch({ type: "open", note: await api.read(current.id, path) });
      setTitleFocus((previous) => ({ path, id: (previous?.id ?? 0) + 1 }));
    });

  const createQuick = () =>
    task(async () => {
      const current = ref.current.vault;
      if (!current) return;
      const entries = await api.list(current.id, "");
      const used = new Set(entries.map((entry) => entry.name.toLowerCase()));
      for (let index = 0; index < 10000; index++) {
        const name = `Новая заметка${index ? ` ${index}` : ""}.md`;
        if (used.has(name.toLowerCase())) continue;
        const path = name;
        try {
          const note = await api.create(current.id, path);
          dispatch({ type: "open", note });
          setRefresh((n) => n + 1);
          setTitleFocus((previous) => ({
            path: note.path,
            id: (previous?.id ?? 0) + 1,
          }));
          return;
        } catch (error) {
          if (
            typeof error === "object" &&
            error !== null &&
            "code" in error &&
            error.code === "AlreadyExists"
          )
            continue;
          throw error;
        }
      }
      throw new Error("Не удалось подобрать свободное имя заметки.");
    });

  const rename = (targetPath?: string, suggestedPath?: string) =>
    task(async () => {
      const current = ref.current.vault;
      const selectedPath = targetPath ?? ref.current.workspace.active;
      let tabs = ref.current.workspace.tabs;
      if (!current || !selectedPath) return;
      if (suggestedPath === selectedPath) return;
      if (suggestedPath) {
        setNotice("");
        // Persist current buffers before planning link changes; revisions prevent overwriting external edits.
        for (const draft of tabs.filter(dirty)) {
          const revision = await api.save(
            current.id,
            draft.path,
            draft.content,
            draft.revision,
          );
          dispatch({
            type: "saved",
            path: draft.path,
            content: draft.content,
            revision,
          });
          tabs = tabs.map((tab) =>
            tab.path === draft.path
              ? { ...tab, revision, savedContent: draft.content }
              : tab,
          );
        }
      }
      const tab = tabs.find((t) => t.path === selectedPath);
      if (tab && dirty(tab))
        throw new Error("Сохраните изменения перед переименованием (Ctrl+S).");
      if (!suggestedPath && !reviewRename)
        throw new Error("Предпросмотр переименования недоступен.");
      const revision =
        tab?.revision ?? (await api.read(current.id, selectedPath)).revision;
      const preview = suggestedPath
        ? await api.previewRename(
            current.id,
            selectedPath,
            suggestedPath,
            revision,
            tabs.map((tab) => tab.path),
          )
        : await reviewRename!({
            vaultId: current.id,
            path: selectedPath,
            revision,
            openPaths: tabs.map((t) => t.path),
            dirtyPaths: tabs.filter(dirty).map((t) => t.path),
          });
      if (!preview) return;
      if (tabs.some((t) => t.path === preview.to && t.path !== preview.from))
        throw new Error(
          "Закройте вкладку целевого пути перед переименованием.",
        );
      if (
        tabs.some((t) => dirty(t) && preview.affectedOpenPaths.includes(t.path))
      )
        throw new Error("Сначала сохраните затронутые вкладки.");
      try {
        const result = await api.applyRename(current.id, preview.token);
        await synchronizeRename(current.id, result, preview.affectedOpenPaths);
        if (!suggestedPath)
          setNotice(
            `Переименовано. Обновлено ссылок: ${preview.links}. Действие можно отменить в панели сведений.`,
          );
      } finally {
        setRenameState(
          await api.renameState(
            current.id,
            tabs.map((t) => t.path),
          ),
        );
        setRefresh((n) => n + 1);
      }
    });

  const synchronizeRename = async (
    vaultId: string,
    result: RenameApplied,
    paths: string[],
  ) => {
    if (result.directory) {
      const prefix = `${result.from}/`,
        next = `${result.note.path}/`;
      const changed = new Set(paths);
      for (const tab of ref.current.workspace.tabs) {
        const path = tab.path.startsWith(prefix)
          ? next + tab.path.slice(prefix.length)
          : tab.path;
        if (path === tab.path && !changed.has(tab.path)) continue;
        try {
          dispatch({
            type: "replace",
            path: tab.path,
            note: await api.read(vaultId, path),
          });
        } catch (error) {
          setError(
            `Папка переименована, но вкладка ${path} не перечитана: ${errorMessage(error)}`,
          );
        }
      }
      setFolder((previous) =>
        previous === result.from
          ? result.note.path
          : previous.startsWith(prefix)
            ? next + previous.slice(prefix.length)
            : previous,
      );
      return;
    }
    const sourceTab =
      ref.current.workspace.tabs.find((t) => t.path === result.from) ??
      ref.current.workspace.tabs.find((t) => t.path === result.note.path);
    if (sourceTab)
      dispatch({ type: "replace", path: sourceTab.path, note: result.note });
    const failures: string[] = [];
    for (const path of paths) {
      if (path === result.from || path === result.note.path) continue;
      const tab = ref.current.workspace.tabs.find((t) => t.path === path);
      if (!tab || dirty(tab)) continue;
      try {
        dispatch({
          type: "replace",
          path,
          note: await api.read(vaultId, path),
        });
      } catch (e) {
        failures.push(`${path}: ${errorMessage(e)}`);
      }
    }
    if (failures.length)
      setError(
        `Операция завершена на диске, но не все вкладки перечитаны: ${failures.join(" · ")}`,
      );
  };

  const undoRename = () =>
    task(async () => {
      const current = ref.current.vault;
      if (!current) return;
      const tabs = ref.current.workspace.tabs;
      const state = await api.renameState(
        current.id,
        tabs.map((t) => t.path),
      );
      setRenameState(state);
      if (!state) return;
      if (
        tabs.some((t) => dirty(t) && state.affectedOpenPaths.includes(t.path))
      )
        throw new Error(
          "Сначала сохраните копии или закройте затронутые несохранённые вкладки.",
        );
      if (
        (await ask({
          title: state.pending
            ? "Восстановить переименование?"
            : "Отменить переименование?",
          description: `${state.to} → ${state.from}. Будут восстановлены прежние имена и ссылки. При внешних изменениях операция остановится, сохранив файлы и резервные копии.`,
          label: state.pending ? "Восстановить" : "Отменить переименование",
        })) === null
      )
        return;
      try {
        const result = await api.undoRename(
          current.id,
          state.id,
          state.pending,
        );
        await synchronizeRename(current.id, result, state.affectedOpenPaths);
        setNotice("Прежние имена и ссылки восстановлены.");
      } finally {
        setRenameState(
          await api.renameState(
            current.id,
            tabs.map((t) => t.path),
          ),
        );
        setRefresh((n) => n + 1);
      }
    });

  const remove = (targetPath?: string) =>
    task(async () => {
      const current = ref.current.vault;
      const selectedPath = targetPath ?? ref.current.workspace.active;
      const tab = ref.current.workspace.tabs.find(
        (t) => t.path === selectedPath,
      );
      if (!current || !selectedPath) return;
      if (tab && dirty(tab))
        throw new Error(
          "Сохраните изменения перед удалением или закройте вкладку, отбросив их.",
        );
      const revision =
        tab?.revision ?? (await api.read(current.id, selectedPath)).revision;
      if (
        (await ask({
          title: "Переместить заметку в корзину?",
          description: `${selectedPath} будет сохранена в .aether/trash внутри хранилища.`,
          label: "В корзину",
          dangerous: true,
        })) === null
      )
        return;
      const path = await api.trash(current.id, selectedPath, revision);
      dispatch({ type: "close", path: selectedPath });
      setNotice(`Файл перемещён в ${path}`);
      setRefresh((n) => n + 1);
    });

  const reload = () =>
    task(async () => {
      const current = ref.current.vault;
      const tab = ref.current.workspace.tabs.find(
        (t) => t.path === ref.current.workspace.active,
      );
      if (!current || !tab) return;
      if (
        dirty(tab) &&
        (await ask({
          title: "Загрузить версию с диска?",
          description:
            "Несохранённый текст будет заменён. Перед этим можно сохранить копию.",
          label: "Перечитать",
          dangerous: true,
        })) === null
      )
        return;
      const note: Note = await api.read(current.id, tab.path);
      dispatch({ type: "replace", path: tab.path, note });
    });

  const openWiki = (source: string, target: string) =>
    task(async () => {
      const current = ref.current.vault;
      if (!current) return;
      const resolution = await api.resolve(current.id, source, target);
      if (resolution.path) {
        const existing = ref.current.workspace.tabs.find(
          (tab) => tab.path === resolution.path,
        );
        const note = existing ?? (await api.read(current.id, resolution.path));
        if (existing) dispatch({ type: "activate", path: resolution.path });
        else dispatch({ type: "open", note });
        const hash = target.indexOf("#");
        if (hash >= 0) {
          const location = await api.locateAnchor(
            current.id,
            note.path,
            note.content,
            target.slice(hash + 1),
          );
          setNavigation({
            ...location,
            path: note.path,
            id: ++navigationId.current,
          });
        }
        return;
      }
      if (resolution.status === "ambiguous")
        throw new Error(
          `Неоднозначная ссылка. Укажите полный путь: ${resolution.candidates.join(", ")}`,
        );
      if (!resolution.createPath)
        throw new Error(
          "Ссылка выходит за пределы хранилища или содержит недопустимый путь.",
        );
      const name = await ask({
        title: "Создать связанную заметку?",
        description: `Заметка «${target}» пока не существует.`,
        initial: resolution.createPath,
        label: "Создать",
      });
      if (name === null) return;
      const note = await api.create(current.id, name.trim());
      dispatch({ type: "open", note });
      setRefresh((n) => n + 1);
    });

  return {
    vault,
    knownVaults,
    switchVault,
    createVault,
    workspace,
    active,
    dispatch,
    busy,
    error,
    setError,
    notice,
    setNotice,
    refresh,
    setRefresh,
    folder,
    setFolder,
    choose,
    open,
    save,
    close,
    create,
    createQuick,
    createFolderQuick,
    removeDirectory: (path: string) =>
      task(async () => {
        const current = ref.current.vault;
        if (!current) return;
        if (
          (await ask({
            title: "Переместить папку в корзину?",
            description: `${path} со всем содержимым будет сохранена в .aether/trash внутри хранилища.`,
            label: "В корзину",
            dangerous: true,
          })) === null
        )
          return;
        const prefix = `${path}/`;
        for (const tab of ref.current.workspace.tabs.filter(
          (tab) => tab.path.startsWith(prefix) && dirty(tab),
        )) {
          const revision = await api.save(
            current.id,
            tab.path,
            tab.content,
            tab.revision,
          );
          dispatch({
            type: "saved",
            path: tab.path,
            content: tab.content,
            revision,
          });
        }
        const result = await api.trashDirectory(current.id, path);
        for (const tab of ref.current.workspace.tabs)
          if (tab.path.startsWith(prefix))
            dispatch({ type: "close", path: tab.path });
        setFolder((previous) =>
          previous === path || previous.startsWith(prefix) ? "" : previous,
        );
        setEntryEdit(null);
        setRefresh((n) => n + 1);
        setNotice(`Папка сохранена в ${result.trash}`);
      }),
    editTitle,
    entryEdit,
    setEntryEdit,
    renameEntry: async (path: string, name: string, directory: boolean) => {
      if (!directory) {
        const extension = path.match(/\.(md|markdown)$/i)?.[0] ?? ".md";
        const destination =
          path.slice(0, path.lastIndexOf("/") + 1) +
          name.replace(/\.(md|markdown)$/i, "") +
          extension;
        const renamed = await rename(path, destination);
        if (renamed) setEntryEdit(null);
        return renamed;
      }
      return task(async () => {
        const current = ref.current.vault;
        if (!current) return;
        const tabs = ref.current.workspace.tabs;
        for (const tab of tabs.filter(dirty)) {
          const revision = await api.save(
            current.id,
            tab.path,
            tab.content,
            tab.revision,
          );
          dispatch({
            type: "saved",
            path: tab.path,
            content: tab.content,
            revision,
          });
        }
        try {
          const result = await api.renameDirectory(current.id, path, name);
          await synchronizeRename(
            current.id,
            result,
            tabs.map((tab) => tab.path),
          );
          setEntryEdit(null);
        } finally {
          setRenameState(
            await api.renameState(
              current.id,
              ref.current.workspace.tabs.map((tab) => tab.path),
            ),
          );
          setRefresh((n) => n + 1);
        }
      });
    },
    moveNote: (path: string, directory: string) => {
      const destination =
        (directory ? `${directory}/` : "") + path.split("/").pop()!;
      return destination === path
        ? Promise.resolve()
        : rename(path, destination);
    },
    titleFocus,
    rename,
    remove,
    reload,
    openWiki,
    navigation,
    renameState,
    undoRename,
  };
}
