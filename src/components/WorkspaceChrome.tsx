import {
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
import { dirty, titleOf } from "../workspace/model";
import { Popover } from "./Popover";
import { useEffect, useLayoutEffect, useRef } from "react";
import { useContextMenu } from "./ContextMenu";
import { api } from "../services/api";
export type Mode = "source" | "live" | "reading";
type Controller = ReturnType<typeof useWorkspace>;
export function WorkspaceTabs({
  app,
}: {
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
  const tabsRef = useRef<HTMLDivElement>(null);
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
  }, [app.workspace.active, app.workspace.tabs.length]);
  return (
    <div className="workspace-tabs">
      <div
        className="tabs"
        ref={tabsRef}
        role="tablist"
        aria-label="Открытые заметки"
      >
        {app.workspace.tabs.map((tab) => (
          <div
            className={`tab ${app.workspace.active === tab.path ? "active" : ""}`}
            key={tab.path}
            onContextMenu={(event) =>
              context.show(event, "Действия вкладки", [
                {
                  label:
                    tab.kind === "image"
                      ? "Перейти к изображению"
                      : "Перейти к заметке",
                  disabled: app.busy,
                  run: () => app.dispatch({ type: "activate", path: tab.path }),
                },
                {
                  label: "Переименовать",
                  disabled: app.busy || tab.kind === "image",
                  run: () => app.editTitle(tab.path),
                },
                {
                  label: "Копировать путь",
                  run: () => navigator.clipboard.writeText(tab.path),
                },
                {
                  label: "Открыть в проводнике",
                  disabled: !app.vault,
                  run: () => api.reveal(app.vault!.id, tab.path),
                },
                {
                  label: "Закрыть вкладку",
                  shortcut: "Ctrl W",
                  divider: true,
                  disabled: app.busy,
                  run: () => app.close(tab.path),
                },
              ])
            }
          >
            <button
              role="tab"
              aria-selected={app.workspace.active === tab.path}
              disabled={app.busy}
              onClick={() => app.dispatch({ type: "activate", path: tab.path })}
              data-tooltip={tab.path}
            >
              {tab.kind === "image" ? (
                <ImageIcon size={14} />
              ) : (
                <FileText size={14} />
              )}
              <span className="tab-name">{titleOf(tab.path)}</span>
              {dirty(tab) && (
                <span
                  className="dirty-dot"
                  data-tooltip="Есть несохранённые изменения"
                />
              )}
            </button>
            <button
              className="tab-close"
              aria-label={`Закрыть ${titleOf(tab.path)}`}
              disabled={app.busy}
              onClick={() => void app.close(tab.path)}
            >
              <X size={13} />
            </button>
          </div>
        ))}
      </div>
      {app.vault && app.workspace.tabs.length > 0 && (
        <button
          className="icon-button new-tab"
          data-tooltip="Новая заметка"
          aria-label="Открыть новую заметку"
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
  formatting,
  setFormatting,
  lineNumbers,
  setLineNumbers,
  lineWrapping,
  setLineWrapping,
}: {
  app: Controller;
  mode: Mode;
  setMode: (mode: Mode) => void;
  formatting: boolean;
  setFormatting: (value: boolean) => void;
  lineNumbers: boolean;
  setLineNumbers: (value: boolean) => void;
  lineWrapping: boolean;
  setLineWrapping: (value: boolean) => void;
}) {
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
            aria-label="Сохранить"
            data-tooltip="Сохранить · Ctrl+S"
            disabled={app.busy}
            onClick={() => void app.save()}
          >
            <Save size={15} />
          </button>
        )}
        <button
          className="icon-button"
          aria-label="Переключить режим чтения"
          aria-pressed={mode === "reading"}
          data-tooltip={
            mode === "reading" ? "Редактировать · Ctrl+E" : "Читать · Ctrl+E"
          }
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
          label="Режим заметки"
          icon={<ChevronDown size={14} />}
          disabled={app.busy}
        >
          {(
            [
              { key: "source", label: "Исходник", icon: Code2 },
              { key: "live", label: "Live Preview", icon: PencilLine },
              { key: "reading", label: "Чтение", icon: BookOpen },
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
          label="Действия с заметкой"
          icon={<MoreHorizontal size={18} />}
          disabled={app.busy}
        >
          <button disabled={!dirty(app.active)} onClick={() => void app.save()}>
            <span>Сохранить заметку</span>
            <kbd>Ctrl S</kbd>
          </button>
          <button onClick={() => void app.editTitle()}>Переименовать</button>
          <button onClick={() => void app.create(false, true)}>
            Сохранить копию
          </button>
          <button onClick={() => void app.reload()}>Перечитать с диска</button>
          {app.renameState && (
            <button onClick={() => void app.undoRename()}>
              {app.renameState.pending
                ? "Восстановить переименование"
                : "Отменить переименование"}
            </button>
          )}
          <hr />
          <button
            aria-pressed={formatting}
            onClick={() => setFormatting(!formatting)}
          >
            <span>Панель форматирования</span>
            {formatting && <Check size={13} />}
          </button>
          <button
            aria-pressed={lineNumbers}
            onClick={() => setLineNumbers(!lineNumbers)}
          >
            <span>Номера строк</span>
            {lineNumbers && <Check size={13} />}
          </button>
          <button
            aria-pressed={lineWrapping}
            onClick={() => setLineWrapping(!lineWrapping)}
          >
            <span>Перенос строк</span>
            {lineWrapping && <Check size={13} />}
          </button>
          <hr />
          <button className="danger-action" onClick={() => void app.remove()}>
            Переместить в корзину
          </button>
        </Popover>
      </div>
    </div>
  );
}
