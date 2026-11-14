import {
  BookOpen,
  Link2,
  MoreHorizontal,
  PencilLine,
  Save,
  Unlink,
  Waypoints,
  X,
} from "lucide-react";
import { t } from "../i18n";
import { dirty, type Tab } from "../workspace/model";
import { Popover } from "./Popover";
import type { Mode } from "./WorkspaceChrome";

export type InspectorTool = "relations" | "graph" | "issues";
export function InspectorTools({
  value,
  onChange,
}: {
  value: InspectorTool;
  onChange: (value: InspectorTool) => void;
}) {
  const tools = [
    { id: "relations", label: t("Связи"), icon: Link2 },
    { id: "graph", label: t("Локальный граф"), icon: Waypoints },
    { id: "issues", label: t("Незавершённые связи"), icon: Unlink },
  ] as const;
  return (
    <div className="inspector-tools">
      <span className="inspector-tool-title">
        {tools.find((item) => item.id === value)?.label}
      </span>
      <div role="group" aria-label={t("Правая панель")}>
        {tools.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            className="icon-button"
            aria-label={label}
            data-tooltip={label}
            aria-pressed={value === id}
            onClick={() => onChange(id)}
          >
            <Icon size={16} />
          </button>
        ))}
      </div>
    </div>
  );
}

export function GroupDocumentToolbar({
  tab,
  active,
  busy,
  mode,
  onMode,
  onSave,
  onClose,
}: {
  tab: Tab;
  active: boolean;
  busy: boolean;
  mode: Mode;
  onMode: (value: Mode) => void;
  onSave: () => void;
  onClose: () => void;
}) {
  const canvas = /\.canvas$/i.test(tab.path);
  const folder = tab.path.split("/").slice(0, -1).join(" / ");
  return (
    <div className="group-document-toolbar" data-active={active}>
      <span className="breadcrumbs" data-tooltip={tab.path}>
        {folder}
      </span>
      <div className="document-actions">
        {dirty(tab) && (
          <button
            className="icon-button note-save"
            aria-label={t("Сохранить")}
            data-tooltip={t("Сохранить")}
            onClick={onSave}
            disabled={busy}
          >
            <Save size={15} />
          </button>
        )}
        {!canvas && tab.kind !== "image" && (
          <button
            className="icon-button"
            aria-label={t("Переключить режим чтения")}
            data-tooltip={t(mode === "reading" ? "Редактировать" : "Чтение")}
            aria-pressed={mode === "reading"}
            onClick={() => onMode(mode === "reading" ? "live" : "reading")}
            disabled={busy}
          >
            {mode === "reading" ? (
              <PencilLine size={16} />
            ) : (
              <BookOpen size={16} />
            )}
          </button>
        )}
        <Popover
          label={t("Действия панели")}
          icon={<MoreHorizontal size={17} />}
          disabled={busy}
        >
          {!canvas && tab.kind !== "image" && (
            <>
              {(["source", "live", "reading"] as const).map((value) => (
                <button
                  key={value}
                  aria-pressed={mode === value}
                  onClick={() => onMode(value)}
                >
                  {value === "source"
                    ? t("Исходник")
                    : value === "live"
                      ? "Live Preview"
                      : t("Чтение")}
                </button>
              ))}
            </>
          )}
          <hr />
          <button onClick={onClose}>
            <X size={15} />
            {t("Объединить панели")}
          </button>
        </Popover>
      </div>
    </div>
  );
}
