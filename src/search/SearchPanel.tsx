import { t, useLocale } from "../i18n";
import { useEffect, useState } from "react";
import { FileText, LoaderCircle, Search } from "lucide-react";
import {
  api,
  errorMessage,
  type IndexStatus,
  type SearchPage,
  type SearchQuery,
} from "../services/api";
export function Highlighted({ text }: { text: string }) {
  useLocale();
  return (
    <>
      {text.split("\u0001").map((part, index) => {
        const end = part.indexOf("\u0002");
        return end < 0 ? (
          <span key={index}>{part}</span>
        ) : (
          <span key={index}>
            <mark>{part.slice(0, end)}</mark>
            {part.slice(end + 1)}
          </span>
        );
      })}
    </>
  );
}
export function SearchPanel({
  vaultId,
  status,
  onOpen,
  command,
}: {
  vaultId: string;
  status: IndexStatus | null;
  onOpen: (path: string) => void;
  command?: {
    id: number;
    action: "clear" | "filters" | "refresh";
  } | null;
}) {
  useLocale();
  const [query, setQuery] = useState<SearchQuery>({
    text: "",
    path: "",
    tag: "",
    property: "",
    value: "",
    offset: 0,
  });
  const [result, setResult] = useState<SearchPage>({
    hits: [],
    hasMore: false,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!command) return;
    setQuery((current) =>
      command.action === "clear"
        ? { ...current, text: "", offset: 0 }
        : command.action === "filters"
          ? {
              ...current,
              path: "",
              tag: "",
              property: "",
              value: "",
              offset: 0,
            }
          : { ...current },
    );
  }, [command]);
  useEffect(() => {
    let disposed = false;
    setBusy(true);
    const timer = window.setTimeout(() => {
      void api
        .search(vaultId, query)
        .then((value) => {
          if (!disposed) {
            setResult(value);
            setError("");
          }
        })
        .catch((e) => {
          if (!disposed) setError(errorMessage(e));
        })
        .finally(() => {
          if (!disposed) setBusy(false);
        });
    }, 200);
    return () => {
      disposed = true;
      window.clearTimeout(timer);
    };
  }, [vaultId, query, status?.revision]);
  const change = (key: keyof SearchQuery, value: string) =>
    setQuery((current) => ({ ...current, [key]: value, offset: 0 }));
  return (
    <section className="search-panel" aria-label={t("Поиск по хранилищу")}>
      <div className="vault-search-input">
        <Search size={15} />
        <input
          autoFocus
          aria-label={t("Поиск по содержимому")}
          placeholder={t("Поиск по заметкам\u2026")}
          value={query.text}
          onChange={(e) => change("text", e.target.value)}
        />
      </div>
      <details className="search-filters">
        <summary>{t("Фильтры")}</summary>
        <input
          aria-label={t("Фильтр пути")}
          placeholder={t("Папка / путь")}
          value={query.path}
          onChange={(e) => change("path", e.target.value)}
        />
        <input
          aria-label={t("Фильтр тега")}
          placeholder={t("#тег")}
          value={query.tag}
          onChange={(e) => change("tag", e.target.value)}
        />
        <div className="property-filter">
          <input
            aria-label={t("Имя свойства")}
            placeholder={t("Свойство")}
            value={query.property}
            onChange={(e) => change("property", e.target.value)}
          />
          <input
            aria-label={t("Значение свойства")}
            placeholder={t("Значение")}
            value={query.value}
            onChange={(e) => change("value", e.target.value)}
          />
        </div>
      </details>
      <div className="search-summary">
        {busy || status?.running ? (
          <LoaderCircle size={12} className="spin" />
        ) : null}
        {status?.running
          ? t`Индексация · ${status.indexed}`
          : t`${status?.indexed ?? 0} заметок в индексе`}
      </div>
      {status?.errors ? (
        <p className="tree-error" data-tooltip={status.message ?? undefined}>
          {t(" Ошибки индексации: ")}
          {status.errors}
        </p>
      ) : null}
      {error && (
        <p role="alert" className="tree-error">
          {t(error)}
        </p>
      )}
      <div className="search-results">
        {result.hits.map((hit) => (
          <button
            className="search-hit"
            key={hit.path}
            onClick={() => onOpen(hit.path)}
            data-tooltip={hit.path}
          >
            <strong>
              <FileText size={13} />
              <span>
                <Highlighted text={hit.title} />
              </span>
            </strong>
            <small>{hit.path}</small>
            <p>
              <Highlighted text={hit.snippet} />
            </p>
          </button>
        ))}
        {!busy && !result.hits.length && (
          <p className="tree-empty">
            {status?.running
              ? t("Поиск обновится после индексации")
              : t("Совпадений нет")}
          </p>
        )}
      </div>
      {(query.offset > 0 || result.hasMore) && (
        <div className="search-pagination">
          <button
            className="text-button"
            disabled={query.offset === 0 || busy}
            onClick={() =>
              setQuery((q) => ({ ...q, offset: Math.max(0, q.offset - 50) }))
            }
          >
            {t(" Назад ")}
          </button>
          <span>
            {result.hits.length
              ? `${query.offset + 1}–${query.offset + result.hits.length}`
              : t("Нет результатов")}
          </span>
          <button
            className="text-button"
            disabled={!result.hasMore || busy}
            onClick={() => setQuery((q) => ({ ...q, offset: q.offset + 50 }))}
          >
            {t(" Далее ")}
          </button>
        </div>
      )}
    </section>
  );
}
