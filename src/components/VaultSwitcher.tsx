import { Check, ChevronDown, FolderOpen, Plus } from "lucide-react";
import { Popover } from "./Popover";
import type { useWorkspace } from "../app/useWorkspace";
type Controller = ReturnType<typeof useWorkspace>;
function displayPath(path: string) {
  return path.startsWith("\\\\?\\") ? path.slice(4) : path;
}
export function VaultSwitcher({
  app,
}: {
  app: Pick<
    Controller,
    "vault" | "knownVaults" | "busy" | "choose" | "switchVault" | "createVault"
  >;
}) {
  const label = `Хранилище: ${app.vault?.name ?? "не выбрано"}`;
  return (
    <Popover
      className="vault-menu"
      triggerClassName="vault-switcher"
      label={label}
      title="Переключить хранилище"
      above
      disabled={app.busy}
      icon={
        <>
          <span>{app.vault?.name ?? "Выбрать хранилище"}</span>
          <ChevronDown size={14} />
        </>
      }
    >
      <div className="vault-menu-label">Хранилища</div>
      <div className="vault-history">
        {app.knownVaults.map((vault) => (
          <button
            key={vault.id}
            className="vault-entry"
            aria-label={`Переключиться на ${vault.name}`}
            aria-current={vault.id === app.vault?.id ? "true" : undefined}
            disabled={app.busy || vault.id === app.vault?.id}
            title={displayPath(vault.path)}
            onClick={() => void app.switchVault(vault.id)}
          >
            <span>
              <strong>{vault.name}</strong>
              <small>{displayPath(vault.path)}</small>
            </span>
            {vault.id === app.vault?.id && <Check size={14} />}
          </button>
        ))}
      </div>
      <hr />
      <button disabled={app.busy} onClick={() => void app.createVault()}>
        <Plus size={15} />
        <span>Создать хранилище…</span>
      </button>
      <button disabled={app.busy} onClick={() => void app.choose()}>
        <FolderOpen size={15} />
        <span>Открыть хранилище…</span>
      </button>
    </Popover>
  );
}
