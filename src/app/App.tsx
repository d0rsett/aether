import { t, useLocale, setLocale } from "../i18n";
import { Welcome } from "../components/Welcome";
import { FormattingToolbar } from "../components/FormattingToolbar";
import { Templates } from "../components/Templates";
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
  Languages,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  Search,
  X,
} from "lucide-react";
import { FileTree } from "../explorer/FileTree";
import { Modal } from "../components/Modal";
import { ImageDocument } from "../components/ImageDocument";
import { imageExtension } from "../services/images";
import { useQuestion } from "../components/useQuestion";
import { useRenameReview } from "../components/RenameDialog";
import { useWorkspace } from "./useWorkspace";
import { api, desktop, errorMessage, type RenderNode } from "../services/api";
import { NotePreviews } from "../services/notePreviews";
import type { PropertyCommand } from "../editor/properties";
import type { PropertyApply } from "../components/InlineProperties";
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
  const locale = useLocale();
  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);
  const { ask, dialog } = useQuestion();
  const renameReview = useRenameReview();
  const vaultCreation = useVaultCreation();
  const app = useWorkspace(ask, renameReview.review, vaultCreation.request);
  const [previews] = useState(() => new NotePreviews());
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
  const [templates, setTemplates] = useState(false);
  const [templateCommand, setTemplateCommand] = useState<{
    id: number;
    text: string;
    path: string;
    vaultId: string;
  } | null>(null);
  const [query, setQuery] = useState("");
  const [help, setHelp] = useState(false);
  const [stats, setStats] = useState({ words: 0, chars: 0, lines: 0 });
  const [mode, setMode] = useState<Mode>("live");
  const [propertyCommand, setPropertyCommand] = useState<
    | (PropertyCommand & {
        path: string;
        vaultId: string;
      })
    | null
  >(null);
  const propertyId = useRef(0);
  const [propertyHistory, setPropertyHistory] = useState<{
    id: number;
    path: string;
    vaultId: string;
    redo: boolean;
  } | null>(null);
  const [propertyFocus, setPropertyFocus] = useState<{
    id: number;
    path: string;
    vaultId: string;
  } | null>(null);
  useEffect(
    () => setPropertyFocus(null),
    [app.vault?.id, app.workspace.active],
  );
  useEffect(
    () => setPropertyCommand(null),
    [app.vault?.id, app.workspace.active],
  );
  useEffect(
    () => setPropertyHistory(null),
    [app.vault?.id, app.workspace.active],
  );
  const [taskCommand, setTaskCommand] = useState<{
    id: number;
    vaultId: string;
    path: string;
    node: RenderNode;
    snapshot: string;
  } | null>(null);
  useEffect(() => setTaskCommand(null), [app.vault?.id, app.workspace.active]);
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
    previews.update(
      app.vault?.id,
      app.workspace.tabs,
      knowledge.status?.revision ?? 0,
    );
  }, [previews, app.vault?.id, app.workspace.tabs, knowledge.status?.revision]);
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
      if (key === "w" && actionRef.current.workspace.active) {
        event.preventDefault();
        void actionRef.current.close(actionRef.current.workspace.active);
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
  const changeLanguage = (next: "ru" | "en") => {
    if (!setLocale(next))
      app.setError(
        t(
          "Не удалось сохранить язык интерфейса. Выбор действует до закрытия приложения.",
        ),
      );
  };
  const commands = [
    {
      title: "Language: English",
      shortcut: "",
      enabled: true,
      action: () => changeLanguage("en"),
    },
    {
      title: "Язык: Русский",
      shortcut: "",
      enabled: true,
      action: () => changeLanguage("ru"),
    },
    {
      title: t("Вставить шаблон"),
      shortcut: "",
      enabled: !!app.active,
      action: () => setTemplates(true),
    },
    {
      title: t("Создать хранилище"),
      shortcut: "Ctrl Shift N",
      action: () => void app.createVault(),
      enabled: true,
    },
    {
      title: t("Панель форматирования"),
      shortcut: "",
      action: () => setFormatting(!formatting),
      enabled: !!app.active,
    },
    {
      title: t("Номера строк"),
      shortcut: "",
      action: () => setLineNumbers(!lineNumbers),
      enabled: !!app.active,
    },
    {
      title: t("Связи и свойства"),
      shortcut: "",
      action: () => setRight(!right),
      enabled: true,
    },
    ...(
      [
        { type: "bold", label: t("Жирный") },
        { type: "italic", label: t("Курсив") },
        {
          type: "heading",
          label: t("Заголовок"),
        },
        { type: "code", label: t("Код") },
        { type: "quote", label: t("Цитата") },
        { type: "list", label: t("Список") },
        { type: "link", label: t("Wiki-ссылка") },
      ] as const
    ).map((item) => ({
      title: t`Форматирование: ${item.label}`,
      shortcut: "",
      action: () => format(item.type),
      enabled: !!app.active && mode !== "reading",
    })),
    ...(
      [
        {
          key: "source",
          title: t("Исходный Markdown"),
        },
        { key: "live", title: "Live Preview" },
        {
          key: "reading",
          title: t("Режим чтения"),
        },
      ] as const
    ).map((item) => ({
      title: item.title,
      shortcut: item.key === "reading" ? "Ctrl E" : "",
      action: () => setMode(item.key),
      enabled: !!app.active,
    })),
    {
      title: app.renameState?.pending
        ? t("Восстановить переименование")
        : t("Отменить переименование"),
      shortcut: "",
      action: () => void app.undoRename(),
      enabled: !!app.renameState,
    },
    {
      title: t("Поиск по хранилищу"),
      shortcut: "Ctrl Shift F",
      action: () => {
        setLeft(true);
        setLeftView("search");
      },
      enabled: !!app.vault,
    },
    {
      title: t("Открыть хранилище"),
      shortcut: "Ctrl O",
      action: () => void app.choose(),
      enabled: true,
    },
    {
      title: t("Новая заметка"),
      shortcut: "Ctrl N",
      action: () => void app.create(),
      enabled: !!app.vault,
    },
    {
      title: t("Создать папку"),
      shortcut: "",
      action: () => void app.create(true),
      enabled: !!app.vault,
    },
    {
      title: t("Сохранить заметку"),
      shortcut: "Ctrl S",
      action: () => void app.save(),
      enabled: !!app.active,
    },
    {
      title: t("Переименовать заметку"),
      shortcut: "",
      action: () => void app.editTitle(),
      enabled: !!app.active,
    },
    {
      title: t("Предпросмотр переименования"),
      shortcut: "",
      action: () => void app.rename(),
      enabled: !!app.active,
    },
    {
      title: t("Сохранить копию"),
      shortcut: "",
      action: () => void app.create(false, true),
      enabled: !!app.active,
    },
    {
      title: t("Перечитать с диска"),
      shortcut: "",
      action: () => void app.reload(),
      enabled: !!app.active,
    },
    {
      title: t("Переключить тему"),
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
    if (!entry.isDirectory && imageExtension(entry.path)) {
      context.show(event, t("Действия с изображением"), [
        {
          label: t("Открыть изображение"),
          run: () => app.open(entry.path),
        },
        {
          label: t("Копировать путь"),
          run: () => navigator.clipboard.writeText(entry.path),
        },
        {
          label: t("Открыть в проводнике"),
          run: () => api.reveal(app.vault!.id, entry.path),
        },
      ]);
      return;
    }
    context.show(
      event,
      entry.isDirectory ? t("Действия с папкой") : t("Действия с файлом"),
      [
        ...(entry.isDirectory
          ? [
              {
                label: t("Новая заметка"),
                run: () => app.create(false, false, entry.path),
              },
              {
                label: t("Новая папка"),
                run: () => app.createFolderQuick(entry.path),
              },
              {
                label: t("Переименовать"),
                run: () => app.setEntryEdit(entry.path),
              },
            ]
          : [
              {
                label: t("Открыть заметку"),
                run: () => app.open(entry.path),
              },
              {
                label: t("Переименовать"),
                run: () => app.setEntryEdit(entry.path),
              },
            ]),
        {
          label: t("Копировать путь"),
          run: () => navigator.clipboard.writeText(entry.path),
        },
        {
          label: t("Открыть в проводнике"),
          run: () => api.reveal(app.vault!.id, entry.path),
        },
        ...(entry.isDirectory
          ? [
              {
                label: t("Обновить дерево"),
                run: () => app.setRefresh((n) => n + 1),
              },
              {
                label: t("Переместить в корзину"),
                danger: true,
                divider: true,
                run: () => app.removeDirectory(entry.path),
              },
            ]
          : [
              {
                label: t("Переместить в корзину"),
                danger: true,
                divider: true,
                run: () => app.remove(entry.path),
              },
            ]),
      ],
    );
  };
  const openPropertiesSource = () => {
    if (!app.active || !app.vault) return;
    setMode("source");
    setPropertyFocus({
      id: ++propertyId.current,
      path: app.active.path,
      vaultId: app.vault.id,
    });
  };
  const changeProperty: PropertyApply = (action, expected, done) => {
    if (!app.active || !app.vault) {
      done(t("Откройте заметку заново."));
      return;
    }
    setPropertyCommand({
      id: ++propertyId.current,
      path: app.active.path,
      vaultId: app.vault.id,
      action,
      expected,
      done,
    });
  };
  const changePropertyHistory = (redo: boolean) => {
    if (!app.active || !app.vault) return;
    setPropertyHistory({
      id: ++propertyId.current,
      path: app.active.path,
      vaultId: app.vault.id,
      redo,
    });
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
        <div
          className="panel-toggles"
          role="group"
          aria-label={t("Боковые панели")}
        >
          <button
            className="icon-button"
            aria-label={
              locale === "en"
                ? "Interface language: English"
                : "Язык интерфейса: Русский"
            }
            data-tooltip={
              locale === "en" ? "Switch to Russian" : "Switch to English"
            }
            onClick={() => changeLanguage(locale === "en" ? "ru" : "en")}
          >
            <Languages size={17} />
          </button>
          <button
            className="icon-button"
            aria-label={t("Переключить левую панель")}
            aria-expanded={left}
            data-tooltip={t("Левая панель · Ctrl+\\")}
            onClick={() => setLeft(!left)}
          >
            {left ? <PanelLeftClose size={17} /> : <PanelLeftOpen size={17} />}
          </button>
          <button
            className="icon-button chrome-right-toggle"
            aria-label={t("Переключить правую панель")}
            aria-expanded={right}
            data-tooltip={t("Связи и свойства")}
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
        <nav className="activity-rail" aria-label={t("Панели приложения")}>
          <button
            className={
              "rail-button " + (left && leftView === "explorer" ? "active" : "")
            }
            aria-label={t("Показать проводник")}
            aria-pressed={left && leftView === "explorer"}
            data-tooltip={t("Файлы")}
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
            aria-label={t("Поиск по хранилищу")}
            aria-pressed={left && leftView === "search"}
            data-tooltip={t("Поиск · Ctrl+Shift+F")}
            onClick={() => {
              setLeft(true);
              setLeftView("search");
            }}
          >
            <Search size={19} />
          </button>
          <button
            className="rail-button"
            aria-label={t("Палитра команд")}
            data-tooltip={t("Команды · Ctrl+P")}
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
              aria-label={t("Переключить тему")}
              data-tooltip={t("Переключить тему")}
              onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
            >
              {theme === "dark" ? <Sun size={18} /> : <Moon size={18} />}
            </button>
            <button
              className="rail-button"
              aria-label={t("Справка")}
              data-tooltip={t("Справка")}
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
                {leftView === "explorer" ? t("Файлы") : t("Поиск")}
              </span>
              <div className="sidebar-tools">
                {leftView === "explorer" ? (
                  <>
                    <button
                      className="icon-button"
                      aria-label={t("Новая заметка")}
                      data-tooltip={t("Новая заметка · Ctrl+N")}
                      disabled={!app.vault || app.busy}
                      onClick={() => void app.create()}
                    >
                      <FilePlus2 size={16} />
                    </button>
                    <button
                      className="icon-button"
                      aria-label={t("Новая папка")}
                      data-tooltip={t("Новая папка")}
                      disabled={!app.vault || app.busy}
                      onClick={() => void app.createFolderQuick()}
                    >
                      <FolderPlus size={16} />
                    </button>
                    <Popover
                      label={t("Действия с файлами")}
                      icon={<MoreHorizontal size={17} />}
                    >
                      {" "}
                      <button
                        disabled={!app.vault || app.busy}
                        onClick={() => app.setRefresh((n) => n + 1)}
                      >
                        {t(" Обновить дерево ")}
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
                        {t(" Открыть хранилище в проводнике ")}
                      </button>
                      <button
                        disabled={app.busy}
                        onClick={() => void app.choose()}
                      >
                        {t(" Открыть хранилище ")}
                      </button>
                    </Popover>
                  </>
                ) : (
                  <Popover
                    label={t("Действия поиска")}
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
                      {t(" Очистить запрос ")}
                    </button>
                    <button
                      onClick={() =>
                        setSearchCommand((previous) => ({
                          id: (previous?.id ?? 0) + 1,
                          action: "filters",
                        }))
                      }
                    >
                      {t(" Сбросить фильтры ")}
                    </button>
                    <button
                      onClick={() =>
                        setSearchCommand((previous) => ({
                          id: (previous?.id ?? 0) + 1,
                          action: "refresh",
                        }))
                      }
                    >
                      {t(" Обновить результаты ")}
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
                context.show(event, t("Действия проводника"), [
                  {
                    label: t("Новая заметка"),
                    run: () => app.create(false, false, ""),
                  },
                  {
                    label: t("Новая папка"),
                    run: () => app.createFolderQuick(),
                  },
                  {
                    label: t("Обновить дерево"),
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
                      {t(" Переместить в корень ")}
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
                <p className="tree-empty">{t("Выберите папку с заметками.")}</p>
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
                {t(" Обнаружено незавершённое переименование: ")}
                {app.renameState.from} → {app.renameState.to}
                {t(". Затронутые файлы защищены от записи. ")}
              </span>
              <button disabled={app.busy} onClick={() => void app.undoRename()}>
                {t(" Восстановить ")}
              </button>
            </div>
          )}
          {app.error && (
            <div className="banner error" role="alert">
              <Info size={16} />
              <span>{t(app.error)}</span>
              {app.active && (
                <button
                  onClick={() => void app.create(false, true)}
                  disabled={app.busy}
                >
                  {t(" Сохранить копию ")}
                </button>
              )}
              <button
                className="icon-button"
                aria-label={t("Скрыть ошибку")}
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
                {t(" Предпросмотр интерфейса. Работа с файлами доступна через")}{" "}
                <code>npm run tauri dev</code>.
              </span>
            </div>
          )}

          {app.active || app.activeImage ? (
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
              {app.active && formatting && mode !== "reading" && (
                <FormattingToolbar
                  onTemplates={() => setTemplates(true)}
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
                      <LoaderCircle size={16} className="spin" />
                      {t(" Загрузка редактора\u2026 ")}
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
                      {tab.kind === "image" && app.vault ? (
                        <ImageDocument
                          vaultId={app.vault.id}
                          path={tab.path}
                          onError={app.setError}
                        />
                      ) : (
                        <>
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
                          <div
                            className="editor-host"
                            hidden={mode === "reading"}
                          >
                            <MarkdownEditor
                              templateCommand={
                                templateCommand?.path === tab.path &&
                                templateCommand.vaultId === app.vault?.id
                                  ? templateCommand
                                  : null
                              }
                              propertyHistory={
                                propertyHistory?.path === tab.path &&
                                propertyHistory.vaultId === app.vault?.id
                                  ? propertyHistory
                                  : null
                              }
                              onPropertiesSource={openPropertiesSource}
                              propertyFocus={
                                propertyFocus?.path === tab.path &&
                                propertyFocus.vaultId === app.vault?.id
                                  ? propertyFocus.id
                                  : undefined
                              }
                              propertyCommand={
                                propertyCommand?.path === tab.path &&
                                propertyCommand.vaultId === app.vault?.id
                                  ? propertyCommand
                                  : null
                              }
                              previews={previews}
                              onNavigate={(source, target) =>
                                void app.openWiki(source, target)
                              }
                              taskCommand={
                                taskCommand?.path === tab.path &&
                                taskCommand.vaultId === app.vault?.id
                                  ? taskCommand
                                  : null
                              }
                              onAttachmentsImported={() =>
                                app.setRefresh((value) => value + 1)
                              }
                              onFormatsChange={(formats) => {
                                if (
                                  actionRef.current.workspace.active !==
                                  tab.path
                                )
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
                                onProperty={changeProperty}
                                onPropertyHistory={changePropertyHistory}
                                onPropertiesSource={openPropertiesSource}
                                previews={previews}
                                onNavigate={(source, target) =>
                                  void app.openWiki(source, target)
                                }
                                onTask={(node, snapshot) =>
                                  setTaskCommand((previous) => ({
                                    id: (previous?.id ?? 0) + 1,
                                    vaultId: app.vault!.id,
                                    path: tab.path,
                                    node,
                                    snapshot,
                                  }))
                                }
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
                        </>
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
              {app.busy && <span>{t("Выполняется операция\u2026")}</span>}
              {app.notice && (
                <button
                  className="status-notice"
                  data-tooltip={t(app.notice)}
                  onClick={() => app.setNotice("")}
                >
                  {t(app.notice)}
                </button>
              )}
            </div>
            <div>
              {app.active && (
                <>
                  <span>
                    {stats.words.toLocaleString(locale)}
                    {t(" слов")}
                  </span>
                  <span>
                    {stats.chars.toLocaleString(locale)}
                    {t(" символов")}
                  </span>
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
      {templates && app.active && app.vault && (
        <Templates
          key={`${app.vault.id}:${app.active.path}`}
          vaultId={app.vault.id}
          path={app.active.path}
          content={app.active.content}
          onClose={() => setTemplates(false)}
          onInsert={(text) => {
            if (!app.active || !app.vault) return;
            setMode("live");
            setTemplateCommand({
              id: Date.now(),
              text,
              path: app.active.path,
              vaultId: app.vault.id,
            });
          }}
        />
      )}
      {vaultCreation.dialog}
      {context.menu}
      {renameReview.dialog}
      {palette && (
        <Modal title={t("Палитра команд")} onClose={() => setPalette(false)}>
          <div className="palette-search">
            <Search size={17} />
            <input
              autoFocus
              placeholder={t("Введите название команды\u2026")}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              aria-label={t("Поиск команды")}
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
        <Modal title={t("Быстрый старт")} onClose={() => setHelp(false)}>
          <p className="modal-description">
            {t(
              " Откройте папку с Markdown-файлами или создайте пустую папку в системном диалоге. Заметки сохраняются по Ctrl+S. Несохранённые черновики резервируются локально через 700 мс после ввода. ",
            )}
          </p>
          <div className="shortcut-list">
            {[
              [t("Открыть хранилище"), "Ctrl O"],
              [t("Создать хранилище"), "Ctrl Shift N"],
              [t("Новая заметка"), "Ctrl N"],
              [t("Сохранить"), "Ctrl S"],
              [t("Закрыть вкладку"), "Ctrl W"],
              [t("Палитра команд"), "Ctrl P"],
              [t("Поиск в заметке"), "Ctrl F"],
              [t("Замена"), "Ctrl H"],
              [t("Чтение / Live Preview"), "Ctrl E"],
              [t("Жирный / курсив"), "Ctrl B / Ctrl I"],
              [t("Отмена / повтор"), "Ctrl Z / Ctrl Y"],
            ].map(([label, shortcut]) => (
              <div key={label}>
                <span>{label}</span>
                <kbd>{shortcut}</kbd>
              </div>
            ))}
          </div>
          <p className="modal-description">
            {t(
              " Source Mode · Ctrl+щелчок по [[wiki-ссылке]] открывает заметку. Поиск по хранилищу \u2014 Ctrl+Shift+F. Backlinks, теги и свойства находятся справа. Режимы исходника, Live Preview и чтения переключаются над заметкой. ",
            )}
          </p>
        </Modal>
      )}
    </div>
  );
}
