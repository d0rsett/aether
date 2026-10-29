import { t, useLocale } from "../i18n";
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
  useLocale();
  const label = t`Хранилище: ${app.vault?.name ?? t("не выбрано")}`;
  return (
    <Popover
      className="vault-menu"
      triggerClassName="vault-switcher"
      label={label}
      title={t("Переключить хранилище")}
      above
      disabled={app.busy}
      icon={
        <>
          <span>{app.vault?.name ?? t("Выбрать хранилище")}</span>
          <ChevronDown size={14} />
        </>
      }
    >
      <div className="vault-menu-label">{t("Хранилища")}</div>
      <div className="vault-history">
        {app.knownVaults.map((vault) => (
          <button
            key={vault.id}
            className="vault-entry"
            aria-label={t`Переключиться на ${vault.name}`}
            aria-current={vault.id === app.vault?.id ? "true" : undefined}
            disabled={app.busy || vault.id === app.vault?.id}
            data-tooltip={displayPath(vault.path)}
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
        <span>{t("Создать хранилище\u2026")}</span>
      </button>
      <button disabled={app.busy} onClick={() => void app.choose()}>
        <FolderOpen size={15} />
        <span>{t("Открыть хранилище\u2026")}</span>
      </button>
    </Popover>
  );
}
