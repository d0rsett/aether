import { FileText, Plus, FolderOpen, FolderPlus } from "lucide-react";
import type { useWorkspace } from "../app/useWorkspace";
type Controller = ReturnType<typeof useWorkspace>;
export function Welcome({
  app,
  onHelp,
}: {
  app: Pick<Controller, "busy" | "vault" | "create" | "choose" | "createVault">;
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
      <button
        className="button secondary"
        disabled={app.busy}
        onClick={() => void (app.vault ? app.create() : app.choose())}
      >
        {app.vault ? <Plus size={15} /> : <FolderOpen size={15} />}{" "}
        {app.vault ? "Создать заметку" : "Открыть хранилище"}
        <kbd>{app.vault ? "Ctrl N" : "Ctrl O"}</kbd>
      </button>
      <button
        className="button secondary"
        disabled={app.busy}
        onClick={() => void app.createVault()}
      >
        <FolderPlus size={15} /> Создать хранилище
      </button>
      <button className="welcome-shortcuts" onClick={onHelp}>
        Горячие клавиши
      </button>
    </div>
  );
}
