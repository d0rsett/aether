import { t, useLocale } from "../i18n";
import {
  Waypoints,
  BookOpen,
  Check,
  ChevronDown,
  Code2,
  FileText,
  Image as ImageIcon,
  MoreHorizontal,
  PencilLine,
  Plus,
  Save,
  X,
} from "lucide-react";
import type { useWorkspace } from "../app/useWorkspace";
import { dirty, titleOf, type Tab } from "../workspace/model";
import { Popover } from "./Popover";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useContextMenu } from "./ContextMenu";
import { api } from "../services/api";
export type Mode = "source" | "live" | "reading";
type Controller = ReturnType<typeof useWorkspace>;
export function WorkspaceTabs({
  app,
  graph,
  onActivateNote,
  showTabList = false,
  closeShortcut = "Ctrl W",
}: {
  graph?: {
    active: boolean;
    position: number;
    onReorder: (position: number) => void;
    onActivate: () => void;
    onClose: () => void;
  };
  onActivateNote?: () => void;
  showTabList?: boolean;
  closeShortcut?: string;
  app: Pick<
    Controller,
    | "workspace"
    | "vault"
    | "busy"
    | "dispatch"
    | "close"
    | "create"
    | "createQuick"
    | "setError"
    | "rename"
    | "editTitle"
  >;
}) {
  useLocale();
  const graphPath = "\0graph";
  const tabs: (Tab | { path: string; kind: "graph" })[] = [
    ...app.workspace.tabs,
  ];
  if (graph)
    tabs.splice(Math.min(graph.position, tabs.length), 0, {
      path: graphPath,
      kind: "graph",
    });
  const activate = (path: string) => {
    if (path === graphPath) graph?.onActivate();
    else {
      onActivateNote?.();
      app.dispatch({ type: "activate", path });
    }
  };
  const close = (path: string) =>
    path === graphPath ? graph?.onClose() : app.close(path);
  const move = (path: string, target: string, after: boolean) => {
    const paths = tabs.map((tab) => tab.path).filter((item) => item !== path);
    paths.splice(paths.indexOf(target) + Number(after), 0, path);
    if (graph) graph.onReorder(paths.indexOf(graphPath));
    if (path === graphPath) return;
    const notes = paths.filter((item) => item !== graphPath);
    const index = notes.indexOf(path);
    const next = notes[index + 1],
      previous = notes[index - 1];
    if (next || previous)
      app.dispatch({
        type: "reorder",
        path,
        target: next ?? previous,
        after: !next,
      });
  };
  const tabsRef = useRef<HTMLDivElement>(null);
  const [overflow, setOverflow] = useState(false);
  const dragged = useRef<{ path: string; vault: string | undefined } | null>(
    null,
  );
  const [drop, setDrop] = useState<{ path: string; after: boolean } | null>(
    null,
  );
  const clearDrag = () => {
    dragged.current = null;
    setDrop(null);
  };
  const insertionTarget = (path: string, after: boolean) => {
    const source = dragged.current?.path;
    if (!source || source === path) return null;
    const remaining = tabs.filter((item) => item.path !== source);
    const targetIndex = remaining.findIndex((item) => item.path === path);
    if (targetIndex < 0) return null;
    const index = targetIndex + Number(after);
    if (index === tabs.findIndex((item) => item.path === source)) return null;
    const next = remaining[index];
    return next ? { path: next.path, after: false } : { path, after: true };
  };
  useEffect(clearDrag, [app.vault?.id]);
  const context = useContextMenu(app.setError);
  useEffect(() => {
    const tabs = tabsRef.current;
    if (!tabs) return;
    const wheel = (event: WheelEvent) => {
      if (event.ctrlKey || tabs.scrollWidth <= tabs.clientWidth) return;
      const delta =
        Math.abs(event.deltaX) > Math.abs(event.deltaY)
          ? event.deltaX
          : event.deltaY;
      const unit =
        event.deltaMode === 1
          ? 16
          : event.deltaMode === 2
            ? tabs.clientWidth
            : 1;
      if (!delta) return;
      event.preventDefault();
      tabs.scrollLeft += delta * unit;
    };
    tabs.addEventListener("wheel", wheel, { passive: false });
    return () => tabs.removeEventListener("wheel", wheel);
  }, []);
  useLayoutEffect(() => {
    const tabs = tabsRef.current;
    if (!tabs) return;
    const reveal = () => {
      setOverflow(tabs.scrollWidth > tabs.clientWidth + 1);
      const active = tabs
        .querySelector('[aria-selected="true"]')
        ?.closest(".tab");
      if (!active) return;
      const viewport = tabs.getBoundingClientRect();
      const rect = active.getBoundingClientRect();
      if (rect.left < viewport.left)
        tabs.scrollLeft -= viewport.left - rect.left + 3;
      else if (rect.right > viewport.right)
        tabs.scrollLeft += rect.right - viewport.right + 3;
    };
    reveal();
    const observer =
      typeof ResizeObserver !== "undefined" ? new ResizeObserver(reveal) : null;
    observer?.observe(tabs);
    return () => observer?.disconnect();
  }, [
    app.workspace.active,
    app.workspace.tabs.length,
    graph?.active,
    graph?.position,
    showTabList,
  ]);
  return (
    <div className="workspace-tabs">
      <div
        className="tabs"
        ref={tabsRef}
        role="tablist"
        aria-label={t("Открытые заметки")}
      >
        {tabs.map((tab) => (
          <div
            className={`tab ${(tab.kind === "graph" ? graph?.active : !graph?.active && app.workspace.active === tab.path) ? "active" : ""} ${drop?.path === tab.path ? (drop.after ? "drop-after" : "drop-before") : ""}`}
            key={tab.path}
            onDragOver={(event) => {
              if (
                app.busy ||
                !dragged.current ||
                dragged.current.vault !== app.vault?.id
              )
                return;
              event.preventDefault();
              event.stopPropagation();
              event.dataTransfer.dropEffect = "move";
              const rect = event.currentTarget.getBoundingClientRect();
              setDrop(
                insertionTarget(
                  tab.path,
                  event.clientX > rect.left + rect.width / 2,
                ),
              );
              const viewport = tabsRef.current?.getBoundingClientRect();
              if (viewport && tabsRef.current) {
                if (event.clientX < viewport.left + 32)
                  tabsRef.current.scrollLeft -= 24;
                if (event.clientX > viewport.right - 32)
                  tabsRef.current.scrollLeft += 24;
              }
            }}
            onDrop={(event) => {
              if (!dragged.current || dragged.current.vault !== app.vault?.id)
                return;
              event.preventDefault();
              event.stopPropagation();
              const rect = event.currentTarget.getBoundingClientRect();
              const target = insertionTarget(
                tab.path,
                event.clientX > rect.left + rect.width / 2,
              );
              if (!app.busy && target)
                move(dragged.current.path, target.path, target.after);
              clearDrag();
            }}
            onContextMenu={(event) =>
              context.show(
                event,
                t("Действия вкладки"),
                tab.kind === "graph"
                  ? [
                      {
                        label: t("Граф связей"),
                        run: () => activate(tab.path),
                      },
                      {
                        label: t("Закрыть вкладку"),
                        shortcut: closeShortcut,
                        run: () => close(tab.path),
                      },
                    ]
                  : [
                      {
                        label:
                          tab.kind === "image"
                            ? t("Перейти к изображению")
                            : t("Перейти к заметке"),
                        disabled: app.busy,
                        run: () => {
                          activate(tab.path);
                        },
                      },
                      {
                        label: t("Переименовать"),
                        disabled: app.busy || tab.kind === "image",
                        run: () => app.editTitle(tab.path),
                      },
                      {
                        label: t("Копировать путь"),
                        run: () => navigator.clipboard.writeText(tab.path),
                      },
                      {
                        label: t("Открыть в проводнике"),
                        disabled: !app.vault,
                        run: () => api.reveal(app.vault!.id, tab.path),
                      },
                      {
                        label: t("Закрыть вкладку"),
                        shortcut: closeShortcut,
                        divider: true,
                        disabled: app.busy,
                        run: () => close(tab.path),
                      },
                    ],
              )
            }
          >
            <button
              role="tab"
              draggable={!app.busy}
              onDragStart={(event) => {
                dragged.current = { path: tab.path, vault: app.vault?.id };
                event.dataTransfer.setData(
                  "application/x-aether-tab",
                  tab.path,
                );
                event.dataTransfer.effectAllowed = "move";
                const tabElement =
                  event.currentTarget.closest<HTMLElement>(".tab");
                if (tabElement) {
                  const rect = tabElement.getBoundingClientRect();
                  event.dataTransfer.setDragImage(
                    tabElement,
                    event.clientX - rect.left,
                    event.clientY - rect.top,
                  );
                }
              }}
              onDragEnd={clearDrag}
              onKeyDown={(event) => {
                if (
                  !event.altKey ||
                  !event.shiftKey ||
                  !["ArrowLeft", "ArrowRight"].includes(event.key)
                )
                  return;
                const index = tabs.findIndex((item) => item.path === tab.path);
                const after = event.key === "ArrowRight";
                const target = tabs[index + (after ? 1 : -1)];
                if (!target) return;
                event.preventDefault();
                move(tab.path, target.path, after);
              }}
              aria-selected={
                tab.kind === "graph"
                  ? graph?.active
                  : !graph?.active && app.workspace.active === tab.path
              }
              disabled={app.busy}
              aria-description={
                tab.kind !== "graph" && dirty(tab)
                  ? t("Есть несохранённые изменения")
                  : undefined
              }
              onClick={() => {
                activate(tab.path);
              }}
              data-tooltip={tab.kind === "graph" ? t("Граф связей") : tab.path}
            >
              {tab.kind === "graph" ? (
                <Waypoints size={14} />
              ) : tab.kind === "image" ? (
                <ImageIcon size={14} />
              ) : (
                <FileText size={14} />
              )}
              <span className="tab-name">
                {tab.kind === "graph" ? t("Граф связей") : titleOf(tab.path)}
              </span>
              {tab.kind !== "graph" && dirty(tab) && (
                <span
                  className="dirty-dot"
                  aria-hidden="true"
                  data-tooltip={t("Есть несохранённые изменения")}
                />
              )}
            </button>
            <button
              className="tab-close"
              aria-label={
                tab.kind === "graph"
                  ? t("Закрыть граф")
                  : t`Закрыть ${titleOf(tab.path)}`
              }
              disabled={app.busy}
              onClick={() => void close(tab.path)}
            >
              <X size={13} />
            </button>
          </div>
        ))}
      </div>
      {showTabList && overflow && (
        <Popover
          className="tab-overflow"
          disabled={app.busy}
          label={t("Список вкладок")}
          icon={<ChevronDown size={15} />}
        >
          {tabs.map((tab) => (
            <button
              key={tab.path}
              onClick={() => activate(tab.path)}
              aria-description={
                tab.kind !== "graph" && dirty(tab)
                  ? t("Есть несохранённые изменения")
                  : undefined
              }
              data-tooltip={tab.kind === "graph" ? t("Граф связей") : tab.path}
              aria-pressed={
                tab.kind === "graph"
                  ? graph?.active
                  : !graph?.active && app.workspace.active === tab.path
              }
            >
              <span>
                {tab.kind === "graph" ? t("Граф связей") : titleOf(tab.path)}
              </span>
              {tab.kind !== "graph" && dirty(tab) && (
                <span className="dirty-dot" aria-hidden="true" />
              )}
            </button>
          ))}
        </Popover>
      )}
      {app.vault && (app.workspace.tabs.length > 0 || graph) && (
        <button
          className="icon-button new-tab"
          data-tooltip={t("Новая заметка")}
          aria-label={t("Открыть новую заметку")}
          disabled={app.busy}
          onClick={() => void app.createQuick()}
        >
          <Plus size={16} />
        </button>
      )}
      {context.menu}
    </div>
  );
}
export function NoteHeader({
  app,
  mode,
  setMode,
  saveShortcut = "Ctrl S",
  readingShortcut = "Ctrl E",
}: {
  app: Controller;
  mode: Mode;
  setMode: (mode: Mode) => void;
  saveShortcut?: string;
  readingShortcut?: string;
}) {
  useLocale();
  if (!app.active) return null;
  const parts = app.active.path.split("/");
  parts.pop();
  return (
    <div className="document-toolbar">
      <div
        className="breadcrumbs"
        data-tooltip={parts.length ? parts.join(" / ") : undefined}
      >
        {parts.length > 0 && <span>{parts.join(" / ")}</span>}
      </div>
      <div className="document-actions">
        {dirty(app.active) && (
          <button
            className="icon-button note-save"
            aria-label={t("Сохранить")}
            data-tooltip={`${t("Сохранить")} · ${saveShortcut}`}
            disabled={app.busy}
            onClick={() => void app.save()}
          >
            <Save size={15} />
          </button>
        )}
        <button
          className="icon-button"
          aria-label={t("Переключить режим чтения")}
          aria-pressed={mode === "reading"}
          data-tooltip={`${t(mode === "reading" ? "Редактировать" : "Чтение")} · ${readingShortcut}`}
          disabled={app.busy}
          onClick={() => setMode(mode === "reading" ? "live" : "reading")}
        >
          {mode === "reading" ? (
            <PencilLine size={16} />
          ) : (
            <BookOpen size={16} />
          )}
        </button>
        <Popover
          label={t("Режим заметки")}
          icon={<ChevronDown size={14} />}
          disabled={app.busy}
        >
          {(
            [
              {
                key: "source",
                label: t("Исходник"),
                icon: Code2,
              },
              { key: "live", label: "Live Preview", icon: PencilLine },
              {
                key: "reading",
                label: t("Чтение"),
                icon: BookOpen,
              },
            ] as const
          ).map((item) => (
            <button
              key={item.key}
              aria-pressed={mode === item.key}
              onClick={() => setMode(item.key)}
            >
              <item.icon size={15} />
              <span>{item.label}</span>
              {mode === item.key && <Check size={13} />}
            </button>
          ))}
        </Popover>
        <Popover
          label={t("Действия с заметкой")}
          icon={<MoreHorizontal size={18} />}
          disabled={app.busy}
        >
          <button disabled={!dirty(app.active)} onClick={() => void app.save()}>
            <span>{t("Сохранить заметку")}</span>
            <kbd>{saveShortcut}</kbd>
          </button>
          <button onClick={() => void app.editTitle()}>
            {t("Переименовать")}
          </button>
          <button onClick={() => void app.create(false, true)}>
            {t(" Сохранить копию ")}
          </button>
          <button onClick={() => void app.reload()}>
            {t("Перечитать с диска")}
          </button>
          {app.renameState && (
            <button onClick={() => void app.undoRename()}>
              {app.renameState.pending
                ? t("Восстановить переименование")
                : t("Отменить переименование")}
            </button>
          )}
          <hr />
          <button className="danger-action" onClick={() => void app.remove()}>
            {t(" Переместить в корзину ")}
          </button>
        </Popover>
      </div>
    </div>
  );
}
