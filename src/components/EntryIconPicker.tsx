import { useState } from "react";
import { t, useLocale } from "../i18n";
import {
  entryIconChoices,
  isEntryIcon,
  type EntryIcon,
} from "../explorer/entryIcons";
import { Modal } from "./Modal";

export function EntryIconPicker({
  name,
  current,
  onSelect,
  onClose,
}: {
  name: string;
  current?: EntryIcon;
  onSelect: (icon: EntryIcon | null) => void;
  onClose: () => void;
}) {
  useLocale();
  const [query, setQuery] = useState("");
  const matches = Object.keys(entryIconChoices)
    .filter(isEntryIcon)
    .filter((id) => {
      const value = query.trim().toLocaleLowerCase();
      const label = entryIconChoices[id][1];
      return [id, label, t(label)].some((part) =>
        part.toLocaleLowerCase().includes(value),
      );
    });
  return (
    <Modal
      title={t("Выбрать значок")}
      onClose={onClose}
      className="entry-icon-picker"
      actions={
        <button
          type="button"
          className="button secondary"
          disabled={!current}
          onClick={() => onSelect(null)}
        >
          {t("Сбросить значок")}
        </button>
      }
    >
      <p className="entry-icon-picker-name">{name}</p>
      <input
        type="search"
        aria-label={t("Поиск значков")}
        placeholder={t("Поиск значков")}
        value={query}
        onChange={(event) => setQuery(event.currentTarget.value)}
      />
      <div className="entry-icon-grid">
        {matches.map((id) => {
          const [Icon, label] = entryIconChoices[id];
          return (
            <button
              type="button"
              key={id}
              className="icon-button"
              aria-label={t(label)}
              title={t(label)}
              aria-pressed={current === id}
              onClick={() => onSelect(id)}
            >
              <Icon size={20} />
            </button>
          );
        })}
      </div>
      {!matches.length && (
        <p className="tree-empty">{t("Значки не найдены.")}</p>
      )}
    </Modal>
  );
}
