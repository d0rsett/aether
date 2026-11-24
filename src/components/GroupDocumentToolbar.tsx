import { BookOpen, MoreHorizontal, PencilLine, Save, X } from "lucide-react";
import { t } from "../i18n";
import { dirty, type Tab } from "../workspace/model";
import { Popover } from "./Popover";
import type { Mode } from "./WorkspaceChrome";

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
  const breadcrumb = tab.path.split("/").join(" / ");
  return (
    <div className="group-document-toolbar" data-active={active}>
      <span className="breadcrumbs" data-tooltip={tab.path}>
        {breadcrumb}
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
