import { Welcome } from "../components/Welcome";
import { FormattingToolbar } from "../components/FormattingToolbar";
import { Inspector } from "../components/Inspector";
import { Titlebar } from "../components/Titlebar";
import { lazy, Suspense, useEffect, useRef, useState } from "react";
import {
  CircleHelp,
  Command,
  FilePlus2,
  FolderOpen,
  FolderPlus,
  Info,
  LoaderCircle,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  Search,
  X,
} from "lucide-react";
import { FileTree } from "../explorer/FileTree";
import { Modal } from "../components/Modal";
import { useQuestion } from "../components/useQuestion";
import { useRenameReview } from "../components/RenameDialog";
import { useWorkspace } from "./useWorkspace";
import { api, desktop, errorMessage } from "../services/api";
import { useKnowledge } from "../hooks/useKnowledge";
import { SearchPanel } from "../search/SearchPanel";
import type { FormatCommand } from "../editor/enhancements";
import {
  NoteHeader,
  WorkspaceTabs,
  type Mode,
} from "../components/WorkspaceChrome";
import { Popover } from "../components/Popover";
import { MoreHorizontal, Moon, Sun } from "lucide-react";
import { BrandMark } from "../components/BrandMark";
import { useVaultCreation } from "../components/CreateVaultDialog";
import { VaultSwitcher } from "../components/VaultSwitcher";
import { PaneResizeHandle, usePaneWidth } from "../components/PaneResizeHandle";
import type { CSSProperties } from "react";
import type { MouseEvent } from "react";
import type { FileEntry } from "../services/api";
import { useContextMenu } from "../components/ContextMenu";
import { NoteTitle } from "../components/NoteTitle";
const ReadingView = lazy(() =>
  import("../reading/ReadingView").then((m) => ({ default: m.ReadingView })),
);
function readFlag(name: string, fallback: boolean): boolean {
  try {
    const value = localStorage.getItem(`aether.ui.${name}`);
    return value === null ? fallback : value === "true";
  } catch {
    return fallback;
  }
}

const MarkdownEditor = lazy(() =>
  import("../editor/MarkdownEditor").then((module) => ({
    default: module.MarkdownEditor,
  })),
);

function initialTheme(): string {
  try {
    return localStorage.getItem("aether.theme") ?? "dark";
  } catch {
    return "dark";
  }
}

export function App() {
  const { ask, dialog } = useQuestion();
  const renameReview = useRenameReview();
  const vaultCreation = useVaultCreation();
  const app = useWorkspace(ask, renameReview.review, vaultCreation.request);
  const context = useContextMenu(app.setError);
  const [dragged, setDragged] = useState<string | null>(null);
  const [rootDrop, setRootDrop] = useState(false);
  useEffect(() => {
    setDragged(null);
    setRootDrop(false);
  }, [app.vault?.id]);
  const [theme, setTheme] = useState(initialTheme);
  const [left, setLeft] = useState(() => readFlag("left", true));
  const [leftView, setLeftView] = useState<"explorer" | "search">("explorer");
  const [searchCommand, setSearchCommand] = useState<{
    id: number;
    action: "clear" | "filters" | "refresh";
  } | null>(null);
  const [right, setRight] = useState(() => readFlag("right", false));
  const [leftWidth, setLeftWidth] = usePaneWidth("left", 240, 180);
  const [rightWidth, setRightWidth] = usePaneWidth("right", 260, 220);
  const [formatting, setFormatting] = useState(() =>
    readFlag("formatting", false),
  );
  const [lineNumbers, setLineNumbers] = useState(() =>
    readFlag("lineNumbers", false),
  );
  const [lineWrapping, setLineWrapping] = useState(() =>
    readFlag("lineWrapping", true),
  );
  const shellRef = useRef<HTMLDivElement>(null);
  const sidebarRef = useRef<HTMLElement>(null);
  useEffect(() => {
    try {
      for (const [key, value] of Object.entries({
        left,
        right,
        formatting,
        lineNumbers,
        lineWrapping,
      }))
        localStorage.setItem(`aether.ui.${key}`, String(value));
    } catch {
      /* Layout remains usable without persistence. */
    }
  }, [left, right, formatting, lineNumbers, lineWrapping]);
  useEffect(() => {
    if (!sidebarRef.current || typeof ResizeObserver === "undefined") return;
    const node = sidebarRef.current;
    const observer = new ResizeObserver(() =>
      shellRef.current?.style.setProperty(
        "--left-pane-actual-width",
        `${node.getBoundingClientRect().width}px`,
      ),
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [left]);
  const [palette, setPalette] = useState(false);
  const [query, setQuery] = useState("");
  const [help, setHelp] = useState(false);
  const [stats, setStats] = useState({ words: 0, chars: 0, lines: 0 });
  const [mode, setMode] = useState<Mode>("live");
  const [formatCommand, setFormatCommand] = useState<{
    id: number;
    type: FormatCommand;
    path: string;
  } | null>(null);
  const formatId = useRef(0);
  const [formatState, setFormatState] = useState<{
    path: string;
    formats: FormatCommand[];
  }>({ path: "", formats: [] });
  const format = (type: FormatCommand) => {
    if (app.active)
      setFormatCommand({ id: ++formatId.current, type, path: app.active.path });
  };
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (
        (event.ctrlKey || event.metaKey) &&
        event.code === "KeyE" &&
        !document.querySelector("dialog[open]")
      ) {
        event.preventDefault();
        setMode((previous) => (previous === "reading" ? "live" : "reading"));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  const actionRef = useRef(app);
  actionRef.current = app;
  const knowledge = useKnowledge(
    app.vault?.id,
    app.active?.path,
    app.active?.revision,
  );
  useEffect(() => {
    if (knowledge.status && !knowledge.status.running)
      app.setRefresh((n) => n + 1);
  }, [knowledge.status?.revision, knowledge.status?.running, app.setRefresh]);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try {
      localStorage.setItem("aether.theme", theme);
    } catch {
      /* Theme remains usable without persistence. */
    }
  }, [theme]);
  useEffect(() => {
    const text = app.active?.content ?? "";
    const timer = window.setTimeout(
      () =>
        setStats({
          words: text.match(/\S+/gu)?.length ?? 0,
          chars: text.length,
          lines: text ? text.split("\n").length : 0,
        }),
      500,
    );
    return () => window.clearTimeout(timer);
  }, [app.active?.content]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (
        !(event.ctrlKey || event.metaKey) ||
        event.altKey ||
        document.querySelector("dialog[open]")
      )
        return;
      const key = event.code.startsWith("Key")
        ? event.code.slice(3).toLowerCase()
        : event.code === "Backslash"
          ? "\\"
          : event.key.toLowerCase();
      if (key === "f" && event.shiftKey) {
        event.preventDefault();
        setLeft(true);
        setLeftView("search");
      }
      if (key === "s") {
        event.preventDefault();
        void actionRef.current.save();
      }
      if (key === "o") {
        event.preventDefault();
        void actionRef.current.choose();
      }
      if (key === "n") {
        event.preventDefault();
        if (event.shiftKey) void actionRef.current.createVault();
        else void actionRef.current.createQuick();
      }
      if (key === "w" && actionRef.current.active) {
        event.preventDefault();
        void actionRef.current.close(actionRef.current.active.path);
      }
      if (key === "p") {
        event.preventDefault();
        setPalette(true);
        setQuery("");
      }
      if (key === "\\") {
        event.preventDefault();
        setLeft((value) => !value);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const commands = [
    {
      title: "Создать хранилище",
      shortcut: "Ctrl Shift N",
      action: () => void app.createVault(),
      enabled: true,
    },
    {
      title: "Панель форматирования",
      shortcut: "",
      action: () => setFormatting(!formatting),
      enabled: !!app.active,
    },
    {
      title: "Номера строк",
      shortcut: "",
      action: () => setLineNumbers(!lineNumbers),
      enabled: !!app.active,
    },
    {
      title: "Связи и свойства",
      shortcut: "",
      action: () => setRight(!right),
      enabled: true,
    },
    ...(
      [
        { type: "bold", label: "Жирный" },
        { type: "italic", label: "Курсив" },
        { type: "heading", label: "Заголовок" },
        { type: "code", label: "Код" },
        { type: "quote", label: "Цитата" },
        { type: "list", label: "Список" },
        { type: "link", label: "Wiki-ссылка" },
      ] as const
    ).map((item) => ({
      title: `Форматирование: ${item.label}`,
      shortcut: "",
      action: () => format(item.type),
      enabled: !!app.active && mode !== "reading",
    })),
    ...(
      [
        { key: "source", title: "Исходный Markdown" },
        { key: "live", title: "Live Preview" },
        { key: "reading", title: "Режим чтения" },
      ] as const
    ).map((item) => ({
      title: item.title,
      shortcut: item.key === "reading" ? "Ctrl E" : "",
      action: () => setMode(item.key),
      enabled: !!app.active,
    })),
    {
      title: app.renameState?.pending
        ? "Восстановить переименование"
        : "Отменить переименование",
      shortcut: "",
      action: () => void app.undoRename(),
      enabled: !!app.renameState,
    },
    {
      title: "Поиск по хранилищу",
      shortcut: "Ctrl Shift F",
      action: () => {
        setLeft(true);
        setLeftView("search");
      },
      enabled: !!app.vault,
    },
    {
      title: "Открыть хранилище",
      shortcut: "Ctrl O",
      action: () => void app.choose(),
      enabled: true,
    },
    {
      title: "Новая заметка",
      shortcut: "Ctrl N",
      action: () => void app.create(),
      enabled: !!app.vault,
    },
    {
      title: "Создать папку",
      shortcut: "",
      action: () => void app.create(true),
      enabled: !!app.vault,
    },
    {
      title: "Сохранить заметку",
      shortcut: "Ctrl S",
      action: () => void app.save(),
      enabled: !!app.active,
    },
    {
      title: "Переименовать заметку",
      shortcut: "",
      action: () => void app.editTitle(),
      enabled: !!app.active,
    },
    {
      title: "Предпросмотр переименования",
      shortcut: "",
      action: () => void app.rename(),
      enabled: !!app.active,
    },
    {
      title: "Сохранить копию",
      shortcut: "",
      action: () => void app.create(false, true),
      enabled: !!app.active,
    },
    {
      title: "Перечитать с диска",
      shortcut: "",
      action: () => void app.reload(),
      enabled: !!app.active,
    },
    {
      title: "Переключить тему",
      shortcut: "",
      action: () => setTheme(theme === "dark" ? "light" : "dark"),
      enabled: true,
    },
  ];

  const entryMenu = (event: MouseEvent<HTMLElement>, entry: FileEntry) => {
    if (app.busy) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    context.show(
      event,
      entry.isDirectory ? "Действия с папкой" : "Действия с файлом",
      [
        ...(entry.isDirectory
          ? [
              {
                label: "Новая заметка",
                run: () => app.create(false, false, entry.path),
              },
              {
                label: "Новая папка",
                run: () => app.createFolderQuick(entry.path),
              },
              {
                label: "Переименовать",
                run: () => app.setEntryEdit(entry.path),
              },
            ]
          : [
              { label: "Открыть заметку", run: () => app.open(entry.path) },
              {
                label: "Переименовать",
                run: () => app.setEntryEdit(entry.path),
              },
            ]),
        {
          label: "Копировать путь",
          run: () => navigator.clipboard.writeText(entry.path),
        },
        {
          label: "Открыть в проводнике",
          run: () => api.reveal(app.vault!.id, entry.path),
        },
        ...(entry.isDirectory
          ? [
              {
                label: "Обновить дерево",
                run: () => app.setRefresh((n) => n + 1),
              },
              {
                label: "Переместить в корзину",
                danger: true,
                divider: true,
                run: () => app.removeDirectory(entry.path),
              },
            ]
          : [
              {
                label: "Переместить в корзину",
                danger: true,
                divider: true,
                run: () => app.remove(entry.path),
              },
            ]),
      ],
    );
  };
  return (
    <div
      className={`app-shell ${left ? "" : "left-collapsed"}`}
      ref={shellRef}
      style={
        {
          "--left-pane-width": `${leftWidth}px`,
          "--right-pane-width": `${rightWidth}px`,
          "--visible-right-width": right ? `${rightWidth}px` : "0px",
        } as CSSProperties
      }
      data-editor-mode={mode}
      onDragOver={(event) => {
        if (!dragged && event.dataTransfer.types.includes("Files")) {
          event.preventDefault();
          event.dataTransfer.dropEffect = "none";
        }
      }}
      onDrop={(event) => {
        if (!dragged && event.dataTransfer.types.includes("Files"))
          event.preventDefault();
      }}
    >
      <Titlebar
        leading={
          <div className="chrome-brand" data-tauri-drag-region>
            <BrandMark />
            {left && (
              <span className="chrome-name" data-tauri-drag-region>
                Aether
              </span>
            )}
          </div>
        }
        onError={app.setError}
      >
        <div className="titlebar-drag-space" data-tauri-drag-region />
        <div className="panel-toggles" role="group" aria-label="Боковые панели">
          <button
            className="icon-button"
            aria-label="Переключить левую панель"
            aria-expanded={left}
            data-tooltip="Левая панель · Ctrl+\\"
            onClick={() => setLeft(!left)}
          >
            {left ? <PanelLeftClose size={17} /> : <PanelLeftOpen size={17} />}
          </button>
          <button
            className="icon-button chrome-right-toggle"
            aria-label="Переключить правую панель"
            aria-expanded={right}
            data-tooltip="Связи и свойства"
            onClick={() => setRight(!right)}
          >
            {right ? (
              <PanelRightClose size={17} />
            ) : (
              <PanelRightOpen size={17} />
            )}
          </button>
        </div>
      </Titlebar>

      <div className="workspace-shell">
        <nav className="activity-rail" aria-label="Панели приложения">
          <button
            className={
              "rail-button " + (left && leftView === "explorer" ? "active" : "")
            }
            aria-label="Показать проводник"
            aria-pressed={left && leftView === "explorer"}
            data-tooltip="Файлы"
            onClick={() => {
              setLeft(true);
              setLeftView("explorer");
            }}
          >
            <FolderOpen size={19} />
          </button>
          <button
            className={
              "rail-button " + (left && leftView === "search" ? "active" : "")
            }
            aria-label="Поиск по хранилищу"
            aria-pressed={left && leftView === "search"}
            data-tooltip="Поиск · Ctrl+Shift+F"
            onClick={() => {
              setLeft(true);
              setLeftView("search");
            }}
          >
            <Search size={19} />
          </button>
          <button
            className="rail-button"
            aria-label="Палитра команд"
            data-tooltip="Команды · Ctrl+P"
            onClick={() => {
              setPalette(true);
              setQuery("");
            }}
          >
            <Command size={19} />
          </button>
          <div className="rail-bottom">
            <button
              className="rail-button"
              aria-label="Переключить тему"
              data-tooltip="Переключить тему"
              onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
            >
              {theme === "dark" ? <Sun size={18} /> : <Moon size={18} />}
            </button>
            <button
              className="rail-button"
              aria-label="Справка"
              data-tooltip="Справка"
              onClick={() => setHelp(true)}
            >
              <CircleHelp size={18} />
            </button>
          </div>
        </nav>

        {left && (
          <aside className="sidebar" ref={sidebarRef}>
            <div className="sidebar-toolbar">
              <span className="sidebar-view-title">
                {leftView === "explorer" ? "Файлы" : "Поиск"}
              </span>
              <div className="sidebar-tools">
                {leftView === "explorer" ? (
                  <>
                    <button
                      className="icon-button"
                      aria-label="Новая заметка"
                      data-tooltip="Новая заметка · Ctrl+N"
                      disabled={!app.vault || app.busy}
                      onClick={() => void app.create()}
                    >
                      <FilePlus2 size={16} />
                    </button>
                    <button
                      className="icon-button"
                      aria-label="Новая папка"
                      data-tooltip="Новая папка"
                      disabled={!app.vault || app.busy}
                      onClick={() => void app.createFolderQuick()}
                    >
                      <FolderPlus size={16} />
                    </button>
                    <Popover
                      label="Действия с файлами"
                      icon={<MoreHorizontal size={17} />}
                    >
                      {" "}
                      <button
                        disabled={!app.vault || app.busy}
                        onClick={() => app.setRefresh((n) => n + 1)}
                      >
                        Обновить дерево
                      </button>
                      <button
                        disabled={!app.vault}
                        onClick={() => {
                          if (app.vault)
                            void api
                              .reveal(app.vault.id)
                              .catch((error) =>
                                app.setError(errorMessage(error)),
                              );
                        }}
                      >
                        Открыть хранилище в проводнике
                      </button>
                      <button
                        disabled={app.busy}
                        onClick={() => void app.choose()}
                      >
                        Открыть хранилище
                      </button>
                    </Popover>
                  </>
                ) : (
                  <Popover
                    label="Действия поиска"
                    icon={<MoreHorizontal size={17} />}
                  >
                    <button
                      onClick={() =>
                        setSearchCommand((previous) => ({
                          id: (previous?.id ?? 0) + 1,
                          action: "clear",
                        }))
                      }
                    >
                      Очистить запрос
                    </button>
                    <button
                      onClick={() =>
                        setSearchCommand((previous) => ({
                          id: (previous?.id ?? 0) + 1,
                          action: "filters",
                        }))
                      }
                    >
                      Сбросить фильтры
                    </button>
                    <button
                      onClick={() =>
                        setSearchCommand((previous) => ({
                          id: (previous?.id ?? 0) + 1,
                          action: "refresh",
                        }))
                      }
                    >
                      Обновить результаты
                    </button>
                  </Popover>
                )}
              </div>
            </div>
            <div
              className="explorer-scroll"
              data-drop-root={rootDrop || undefined}
              inert={app.busy}
              onDragOver={(event) => {
                if (!dragged || leftView !== "explorer") return;
                event.preventDefault();
                event.dataTransfer.dropEffect = dragged.includes("/")
                  ? "move"
                  : "none";
                setRootDrop(dragged.includes("/"));
              }}
              onDragLeave={(event) => {
                if (
                  !event.currentTarget.contains(
                    event.relatedTarget as Node | null,
                  )
                )
                  setRootDrop(false);
              }}
              onDrop={(event) => {
                if (!dragged || leftView !== "explorer") return;
                event.preventDefault();
                if (dragged.includes("/")) void app.moveNote(dragged, "");
                setDragged(null);
                setRootDrop(false);
              }}
              onContextMenu={(event) => {
                if (leftView !== "explorer" || !app.vault) return;
                context.show(event, "Действия проводника", [
                  {
                    label: "Новая заметка",
                    run: () => app.create(false, false, ""),
                  },
                  {
                    label: "Новая папка",
                    run: () => app.createFolderQuick(),
                  },
                  {
                    label: "Обновить дерево",
                    divider: true,
                    run: () => app.setRefresh((n) => n + 1),
                  },
                ]);
              }}
            >
              {app.vault && leftView === "search" ? (
                <SearchPanel
                  vaultId={app.vault.id}
                  status={knowledge.status}
                  onOpen={(path) => void app.open(path)}
                  command={searchCommand}
                />
              ) : app.vault ? (
                <>
                  {dragged && (
                    <div className="tree-root-dropzone">
                      Переместить в корень
                    </div>
                  )}
                  <FileTree
                    key={app.vault.id}
                    vaultId={app.vault.id}
                    active={app.workspace.active}
                    refresh={app.refresh}
                    onOpen={(path) => void app.open(path)}
                    onFolder={app.setFolder}
                    onContext={entryMenu}
                    editPath={app.entryEdit}
                    busy={app.busy}
                    onRename={app.renameEntry}
                    onCancelRename={() => app.setEntryEdit(null)}
                    onError={app.setError}
                    dragged={dragged}
                    onDrag={(path) => {
                      setDragged(path);
                      setRootDrop(false);
                    }}
                    onMove={(path, directory) => {
                      setDragged(null);
                      setRootDrop(false);
                      void app.moveNote(path, directory);
                    }}
                  />
                </>
              ) : (
                <p className="tree-empty">Выберите папку с заметками.</p>
              )}
            </div>
            <VaultSwitcher app={app} />
            <PaneResizeHandle
              side="left"
              width={leftWidth}
              minimum={180}
              defaultWidth={240}
              onWidth={setLeftWidth}
              onCollapse={() => setLeft(false)}
            />
          </aside>
        )}

        <main className="main-pane">
          <WorkspaceTabs app={app} />
          {app.renameState?.pending && (
            <div className="banner error" role="alert">
              <Info size={16} />
              <span>
                Обнаружено незавершённое переименование: {app.renameState.from}{" "}
                → {app.renameState.to}. Затронутые файлы защищены от записи.
              </span>
              <button disabled={app.busy} onClick={() => void app.undoRename()}>
                Восстановить
              </button>
            </div>
          )}
          {app.error && (
            <div className="banner error" role="alert">
              <Info size={16} />
              <span>{app.error}</span>
              {app.active && (
                <button
                  onClick={() => void app.create(false, true)}
                  disabled={app.busy}
                >
                  Сохранить копию
                </button>
              )}
              <button
                className="icon-button"
                aria-label="Скрыть ошибку"
                onClick={() => app.setError("")}
              >
                <X size={15} />
              </button>
            </div>
          )}
          {!desktop && (
            <div className="banner preview">
              <Info size={15} />
              <span>
                Предпросмотр интерфейса. Работа с файлами доступна через{" "}
                <code>npm run tauri dev</code>.
              </span>
            </div>
          )}

          {app.active ? (
            <>
              <NoteHeader
                app={app}
                mode={mode}
                setMode={setMode}
                formatting={formatting}
                setFormatting={setFormatting}
                lineNumbers={lineNumbers}
                setLineNumbers={setLineNumbers}
                lineWrapping={lineWrapping}
                setLineWrapping={setLineWrapping}
              />
              {formatting && mode !== "reading" && (
                <FormattingToolbar
                  active={
                    formatState.path === app.active.path
                      ? formatState.formats
                      : []
                  }
                  disabled={app.busy}
                  onFormat={format}
                  onClose={() => setFormatting(false)}
                />
              )}
              <div className="document-area" inert={app.busy}>
                <Suspense
                  fallback={
                    <div className="tree-loading">
                      <LoaderCircle size={16} className="spin" /> Загрузка
                      редактора…
                    </div>
                  }
                >
                  {app.workspace.tabs.map((tab) => (
                    <div
                      className="editor-tab-panel"
                      role="tabpanel"
                      hidden={tab.path !== app.workspace.active}
                      key={`${app.vault?.id}:${tab.path}`}
                    >
                      <NoteTitle
                        focusRequest={
                          app.titleFocus?.path === tab.path
                            ? app.titleFocus.id
                            : undefined
                        }
                        path={tab.path}
                        disabled={app.busy}
                        rename={app.rename}
                        onError={app.setError}
                      />
                      <div className="editor-host" hidden={mode === "reading"}>
                        <MarkdownEditor
                          onFormatsChange={(formats) => {
                            if (actionRef.current.workspace.active !== tab.path)
                              return;
                            setFormatState((previous) =>
                              previous.path === tab.path &&
                              previous.formats.join() === formats.join()
                                ? previous
                                : { path: tab.path, formats },
                            );
                          }}
                          showLineNumbers={lineNumbers}
                          lineWrapping={lineWrapping}
                          visible={
                            mode !== "reading" &&
                            tab.path === app.workspace.active
                          }
                          theme={theme}
                          onError={app.setError}
                          live={mode === "live"}
                          vaultId={app.vault?.id}
                          path={tab.path}
                          command={
                            formatCommand?.path === tab.path
                              ? formatCommand
                              : null
                          }
                          ready={
                            !app.busy &&
                            mode !== "reading" &&
                            tab.path === app.workspace.active
                          }
                          navigation={
                            app.navigation?.path === tab.path
                              ? app.navigation
                              : null
                          }
                          content={tab.content}
                          onChange={(content) =>
                            app.dispatch({
                              type: "edit",
                              path: tab.path,
                              content,
                            })
                          }
                          onSave={() => void app.save()}
                          onWikiLink={(target) =>
                            void app.openWiki(tab.path, target)
                          }
                        />
                      </div>
                      {mode === "reading" &&
                        tab.path === app.workspace.active &&
                        app.vault && (
                          <ReadingView
                            theme={theme}
                            vaultId={app.vault.id}
                            path={tab.path}
                            content={tab.content}
                            navigation={
                              app.navigation?.path === tab.path
                                ? app.navigation
                                : null
                            }
                            onWiki={(target) =>
                              void app.openWiki(tab.path, target)
                            }
                            onError={app.setError}
                          />
                        )}
                    </div>
                  ))}
                </Suspense>
              </div>
            </>
          ) : (
            <Welcome app={app} onHelp={() => setHelp(true)} />
          )}
          <footer className="status-bar">
            <div>
              {app.busy && <span>Выполняется операция…</span>}
              {app.notice && (
                <button
                  className="status-notice"
                  data-tooltip={app.notice}
                  onClick={() => app.setNotice("")}
                >
                  {app.notice}
                </button>
              )}
            </div>
            <div>
              {app.active && (
                <>
                  <span>{stats.words.toLocaleString("ru")} слов</span>
                  <span>{stats.chars.toLocaleString("ru")} символов</span>
                </>
              )}
            </div>
          </footer>
        </main>

        {right && (
          <div className="right-pane">
            <PaneResizeHandle
              side="right"
              width={rightWidth}
              minimum={220}
              defaultWidth={260}
              onWidth={setRightWidth}
              onCollapse={() => setRight(false)}
            />
            <Inspector
              app={app}
              inspection={knowledge.inspection}
              knowledgeError={knowledge.error}
            />
          </div>
        )}
      </div>

      {dialog}
      {vaultCreation.dialog}
      {context.menu}
      {renameReview.dialog}
      {palette && (
        <Modal title="Палитра команд" onClose={() => setPalette(false)}>
          <div className="palette-search">
            <Search size={17} />
            <input
              autoFocus
              placeholder="Введите название команды…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              aria-label="Поиск команды"
            />
          </div>
          <div className="command-list">
            {commands
              .filter((command) =>
                command.title.toLowerCase().includes(query.toLowerCase()),
              )
              .map((command) => (
                <button
                  key={command.title}
                  disabled={!command.enabled || app.busy}
                  onClick={() => {
                    setPalette(false);
                    command.action();
                  }}
                >
                  <span>{command.title}</span>
                  <kbd>{command.shortcut}</kbd>
                </button>
              ))}
          </div>
        </Modal>
      )}
      {help && (
        <Modal title="Быстрый старт" onClose={() => setHelp(false)}>
          <p className="modal-description">
            Откройте папку с Markdown-файлами или создайте пустую папку в
            системном диалоге. Заметки сохраняются по Ctrl+S. Несохранённые
            черновики резервируются локально через 700 мс после ввода.
          </p>
          <div className="shortcut-list">
            {[
              ["Открыть хранилище", "Ctrl O"],
              ["Создать хранилище", "Ctrl Shift N"],
              ["Новая заметка", "Ctrl N"],
              ["Сохранить", "Ctrl S"],
              ["Закрыть вкладку", "Ctrl W"],
              ["Палитра команд", "Ctrl P"],
              ["Поиск в заметке", "Ctrl F"],
              ["Замена", "Ctrl H"],
              ["Чтение / Live Preview", "Ctrl E"],
              ["Жирный / курсив", "Ctrl B / Ctrl I"],
              ["Отмена / повтор", "Ctrl Z / Ctrl Y"],
            ].map(([label, shortcut]) => (
              <div key={label}>
                <span>{label}</span>
                <kbd>{shortcut}</kbd>
              </div>
            ))}
          </div>
          <p className="modal-description">
            Source Mode · Ctrl+щелчок по [[wiki-ссылке]] открывает заметку.
            Поиск по хранилищу — Ctrl+Shift+F. Backlinks, теги и свойства
            находятся справа. Режимы исходника, Live Preview и чтения
            переключаются над заметкой.
          </p>
        </Modal>
      )}
    </div>
  );
}
