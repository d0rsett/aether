import { t, useLocale } from "../i18n";
import { FileText, Plus, FolderOpen, FolderPlus } from "lucide-react";
import type { useWorkspace } from "../app/useWorkspace";
type Controller = ReturnType<typeof useWorkspace>;
export function Welcome({
  app,
  onHelp,
}: {
  app: Pick<
    Controller,
    "busy" | "vault" | "createQuick" | "choose" | "createVault"
  >;
  onHelp: () => void;
}) {
  useLocale();
  return (
    <div className="welcome quiet-welcome">
      <FileText size={34} strokeWidth={1} />
      <h1>{app.vault ? t("Новая заметка") : "Aether"}</h1>
      <p>
        {app.vault
          ? t("Выберите файл слева или начните с пустой заметки.")
          : t("Откройте папку с заметками или создайте новое хранилище.")}
      </p>
      {app.vault && (
        <button
          className="button secondary"
          aria-label={t("Создать заметку")}
          aria-keyshortcuts="Control+N"
          disabled={app.busy}
          onClick={() => void app.createQuick()}
        >
          <span className="welcome-action-label">
            <Plus size={15} />
            {t(" Создать заметку ")}
          </span>
          <kbd>Ctrl N</kbd>
        </button>
      )}
      <button
        className="button secondary"
        aria-label={t("Создать хранилище")}
        aria-keyshortcuts="Control+Shift+N"
        disabled={app.busy}
        onClick={() => void app.createVault()}
      >
        <span className="welcome-action-label">
          <FolderPlus size={15} />
          {t(" Создать хранилище ")}
        </span>
        <kbd>Ctrl Shift N</kbd>
      </button>
      <button
        className="button secondary"
        aria-label={t("Открыть хранилище")}
        aria-keyshortcuts="Control+O"
        disabled={app.busy}
        onClick={() => void app.choose()}
      >
        <span className="welcome-action-label">
          <FolderOpen size={15} />
          {t(" Открыть хранилище ")}
        </span>
        <kbd>Ctrl O</kbd>
      </button>
      <button className="welcome-shortcuts" onClick={onHelp}>
        {t(" Горячие клавиши ")}
      </button>
    </div>
  );
}
