import { useEffect, useId, useRef, useState } from "react";
import { ArrowDown, ArrowUp, FileText, Search } from "lucide-react";
import { t } from "../i18n";
import { api, errorMessage, type NoteSuggestion } from "../services/api";
import { titleOf } from "../workspace/model";
import { Modal } from "./Modal";

export function NotePicker({
  vault,
  title,
  initial = "",
  recent,
  refresh,
  onClose,
  onChoose,
}: {
  vault: string;
  title: string;
  initial?: string;
  recent: string[];
  refresh: number;
  onClose: () => void;
  onChoose: (path: string) => Promise<boolean>;
}) {
  const [query, setQuery] = useState(initial);
  const [index, setIndex] = useState(0);
  const [result, setResult] = useState<{
    query: string;
    refresh: number;
    items: NoteSuggestion[];
    error?: string;
  } | null>(null);
  const [error, setError] = useState("");
  const [choosing, setChoosing] = useState(false);
  const running = useRef(false);
  const listId = useId();
  const trimmed = query.trim();
  const current =
    result?.query === trimmed && result.refresh === refresh ? result : null;
  const showRecent = !trimmed && recent.length > 0;
  const hits = showRecent
    ? recent.map((path) => ({ path, alias: null, title: "" }))
    : (current?.items ?? []);
  const seen = new Set<string>();
  const items = hits.filter(({ path }) => {
    if (seen.has(path)) return false;
    seen.add(path);
    return true;
  });
  const selected = Math.min(index, items.length - 1);

  useEffect(() => {
    if (showRecent) return;
    let current = true;
    const timer = window.setTimeout(
      () => {
        void api.linkSuggestions(vault, trimmed, true).then(
          (items) => {
            if (current) setResult({ query: trimmed, refresh, items });
          },
          (error: unknown) => {
            if (current)
              setResult({
                query: trimmed,
                refresh,
                items: [],
                error: errorMessage(error),
              });
          },
        );
      },
      trimmed ? 100 : 0,
    );
    return () => {
      current = false;
      window.clearTimeout(timer);
    };
  }, [vault, trimmed, showRecent, refresh]);

  useEffect(() => {
    if (selected >= 0)
      document
        .getElementById(`${listId}-${selected}`)
        ?.scrollIntoView?.({ block: "nearest" });
  }, [selected, listId, current]);

  const choose = async (path: string) => {
    if (running.current) return;
    running.current = true;
    setChoosing(true);
    setError("");
    try {
      if (!(await onChoose(path))) setChoosing(false);
    } catch (error) {
      setError(errorMessage(error));
      setChoosing(false);
    } finally {
      running.current = false;
    }
  };

  return (
    <Modal title={title} className="note-picker" onClose={onClose}>
      <div className="palette-search">
        <Search size={17} aria-hidden="true" />
        <input
          role="combobox"
          aria-label={t("Название или псевдоним заметки")}
          placeholder={t("Название или псевдоним заметки")}
          aria-autocomplete="list"
          aria-haspopup="listbox"
          aria-expanded={items.length > 0}
          aria-controls={listId}
          aria-activedescendant={
            selected >= 0 ? `${listId}-${selected}` : undefined
          }
          readOnly={choosing}
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setIndex(0);
            setError("");
          }}
          onKeyDown={(event) => {
            if (event.nativeEvent.isComposing || choosing || !items.length)
              return;
            if (event.key === "ArrowDown" || event.key === "ArrowUp") {
              event.preventDefault();
              const delta = event.key === "ArrowDown" ? 1 : -1;
              setIndex((selected + delta + items.length) % items.length);
            } else if (event.key === "Enter") {
              event.preventDefault();
              void choose(items[selected].path);
            }
          }}
        />
      </div>
      {showRecent && (
        <p className="note-picker-caption">{t("Недавние заметки")}</p>
      )}
      {(error || current?.error) && (
        <p role="alert">{error || current?.error}</p>
      )}
      <div
        id={listId}
        className="command-list note-picker-list"
        role="listbox"
        aria-label={t("Заметки")}
      >
        {items.map(({ path, alias, title }, i) => (
          <button
            type="button"
            role="option"
            tabIndex={-1}
            aria-selected={i === selected}
            key={path}
            id={`${listId}-${i}`}
            disabled={choosing}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => void choose(path)}
          >
            <FileText size={16} aria-hidden="true" />
            <span>
              <strong>{alias ?? (title || titleOf(path))}</strong>
              <small>{path}</small>
            </span>
          </button>
        ))}
      </div>
      {!items.length && !current?.error && (
        <p className="note-picker-caption" role="status">
          {t(current ? "Заметки не найдены." : "Поиск заметок…")}
        </p>
      )}
      {items.length > 0 && (
        <div className="note-picker-keys" aria-hidden="true">
          <kbd>
            <ArrowUp size={12} />
            <ArrowDown size={12} />
          </kbd>
          <span>{t("Выбрать")}</span>
          <kbd>↵</kbd>
          <span>{t("Подтвердить")}</span>
        </div>
      )}
    </Modal>
  );
}
