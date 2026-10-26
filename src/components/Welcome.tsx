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
  return (
    <div className="welcome quiet-welcome">
      <FileText size={34} strokeWidth={1} />
      <h1>{app.vault ? "Новая заметка" : "Aether"}</h1>
      <p>
        {app.vault
          ? "Выберите файл слева или начните с пустой заметки."
          : "Откройте папку с заметками или создайте новое хранилище."}
      </p>
      {app.vault && (
        <button
          className="button secondary"
          aria-label="Создать заметку"
          aria-keyshortcuts="Control+N"
          disabled={app.busy}
          onClick={() => void app.createQuick()}
        >
          <span className="welcome-action-label">
            <Plus size={15} /> Создать заметку
          </span>
          <kbd>Ctrl N</kbd>
        </button>
      )}
      <button
        className="button secondary"
        aria-label="Создать хранилище"
        aria-keyshortcuts="Control+Shift+N"
        disabled={app.busy}
        onClick={() => void app.createVault()}
      >
        <span className="welcome-action-label">
          <FolderPlus size={15} /> Создать хранилище
        </span>
        <kbd>Ctrl Shift N</kbd>
      </button>
      <button
        className="button secondary"
        aria-label="Открыть хранилище"
        aria-keyshortcuts="Control+O"
        disabled={app.busy}
        onClick={() => void app.choose()}
      >
        <span className="welcome-action-label">
          <FolderOpen size={15} /> Открыть хранилище
        </span>
        <kbd>Ctrl O</kbd>
      </button>
      <button className="welcome-shortcuts" onClick={onHelp}>
        Горячие клавиши
      </button>
    </div>
  );
}
