import { useMemo, useState } from "react";
import { t } from "../i18n";
import {
  isEntryIcon,
  type EntryIcon,
  type EntryIcons,
} from "../explorer/entryIcons";

const key = (vault: string) => `aether.entry-icons.v1:${vault}`;
const empty: EntryIcons = new Map();

export function readEntryIcons(vault: string): EntryIcons {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(key(vault)) ?? "null");
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return empty;
    const result = new Map<string, EntryIcon>();
    for (const [path, icon] of Object.entries(raw)) {
      if (path && isEntryIcon(icon)) result.set(path, icon);
    }
    return result;
  } catch {
    return empty;
  }
}

export function remapEntryIcons(
  icons: EntryIcons,
  from: string,
  to: string | null,
  directory: boolean,
): EntryIcons {
  const next = new Map(icons);
  for (const [path, icon] of icons) {
    if (path !== from && !(directory && path.startsWith(from + "/"))) continue;
    next.delete(path);
    if (to !== null) next.set(to + path.slice(from.length), icon);
  }
  return next;
}

export function useEntryIcons(
  vault: string | undefined,
  onError: (error: string) => void,
) {
  const [version, setVersion] = useState(0);
  const icons = useMemo(
    () => (vault ? readEntryIcons(vault) : empty),
    [vault, version],
  );
  const write = (vaultId: string, next: EntryIcons) => {
    try {
      localStorage.setItem(
        key(vaultId),
        JSON.stringify(Object.fromEntries(next)),
      );
      setVersion((current) => current + 1);
      return true;
    } catch {
      onError(t("Не удалось сохранить значки файлов."));
      return false;
    }
  };
  return {
    icons,
    assign(vaultId: string, path: string, icon: EntryIcon | null) {
      const next = new Map(readEntryIcons(vaultId));
      if (icon === null) next.delete(path);
      else next.set(path, icon);
      return write(vaultId, next);
    },
    remap(
      vaultId: string,
      from: string,
      to: string | null,
      directory: boolean,
    ) {
      const current = readEntryIcons(vaultId);
      if (
        ![...current.keys()].some(
          (path) => path === from || (directory && path.startsWith(from + "/")),
        )
      )
        return;
      write(vaultId, remapEntryIcons(current, from, to, directory));
    },
  };
}
