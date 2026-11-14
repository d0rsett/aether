import { useEffect, useState } from "react";
import {
  CheckCheck,
  ChevronLeft,
  ChevronRight,
  FileQuestion,
  FileText,
  LoaderCircle,
  Plus,
  RefreshCw,
  Unlink,
} from "lucide-react";
import { api, type LinkIssue } from "../services/api";
import { t } from "../i18n";
import { titleOf } from "../workspace/model";

export function LinkIssues({
  vaultId,
  revision,
  indexRunning = false,
  onOpen,
  onResolve,
}: {
  vaultId: string;
  revision: number;
  indexRunning?: boolean;
  onOpen: (path: string, line: number) => void;
  onResolve: (source: string, target: string) => void;
}) {
  const [offset, setOffset] = useState(0);
  const [retry, setRetry] = useState(0);
  const [data, setData] = useState<{
    items: LinkIssue[];
    hasMore: boolean;
  } | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    let cancelled = false;
    setData(null);
    setError(false);
    if (indexRunning) return;
    void api
      .linkIssues(vaultId, offset)
      .then((value) => {
        if (!cancelled) setData(value);
      })
      .catch(() => {
        if (!cancelled) setError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [vaultId, revision, offset, retry, indexRunning]);
  return (
    <section className="link-issues" aria-label={t("Незавершённые связи")}>
      <div className="issue-summary">
        <span>{t("По сохранённым заметкам")}</span>
        <button
          type="button"
          className="icon-button"
          aria-label={t("Обновить")}
          data-tooltip={t("Обновить")}
          onClick={() => setRetry((value) => value + 1)}
          disabled={indexRunning || (!data && !error)}
        >
          <RefreshCw size={14} />
        </button>
      </div>
      {error && (
        <div className="sidebar-empty" role="alert">
          <Unlink size={24} />
          <p>{t("Не удалось проверить ссылки.")}</p>
          <button
            className="button"
            onClick={() => setRetry((value) => value + 1)}
          >
            {t("Повторить")}
          </button>
        </div>
      )}
      {!data && !error && (
        <div className="sidebar-empty" role="status">
          <LoaderCircle size={22} className="spin" />
          <p>{t(indexRunning ? "Обновление индекса…" : "Проверка ссылок…")}</p>
        </div>
      )}
      {data?.items.length === 0 && (
        <div className="sidebar-empty">
          <CheckCheck size={26} />
          <p>{t("Все связи на месте")}</p>
          <span>{t("Отсутствующих заметок и вложений нет.")}</span>
        </div>
      )}
      <div className="issue-list">
        {data?.items.map((item, index) => (
          <article className="link-issue" key={item.source + ":" + index}>
            <div className="issue-target-row">
              <FileQuestion size={15} aria-hidden="true" />
              <button
                className="issue-target"
                onClick={() => onOpen(item.source, item.line)}
                data-tooltip={t("Открыть исходную строку")}
              >
                {item.target}
              </button>
              {item.kind === "missing" && (
                <button
                  className="icon-button"
                  aria-label={t("Создать заметку")}
                  data-tooltip={t("Создать заметку")}
                  onClick={() => onResolve(item.source, item.target)}
                >
                  <Plus size={15} />
                </button>
              )}
            </div>
            <span className="issue-kind">
              {t(
                item.kind === "attachment"
                  ? "Вложение не найдено"
                  : item.kind === "ambiguous"
                    ? "Неоднозначная ссылка"
                    : "Заметка не найдена",
              )}
            </span>
            <button
              className="issue-source"
              onClick={() => onOpen(item.source, item.line)}
              data-tooltip={item.source}
            >
              <FileText size={12} />
              <span>{titleOf(item.source)}</span>
              <span>:{item.line}</span>
            </button>
            {item.kind === "ambiguous" && (
              <details className="issue-candidates">
                <summary>
                  {t("Возможные заметки")} · {item.candidates.length}
                </summary>
                {item.candidates.map((path) => (
                  <button key={path} onClick={() => onOpen(path, 1)}>
                    {path}
                  </button>
                ))}
              </details>
            )}
          </article>
        ))}
      </div>
      {!!data && (!!offset || data.hasMore) && (
        <div className="issue-pagination">
          <button
            className="icon-button"
            aria-label={t("Назад")}
            disabled={!offset}
            onClick={() => setOffset((value) => Math.max(0, value - 100))}
          >
            <ChevronLeft size={16} />
          </button>
          <span>
            {offset + 1}–{offset + data.items.length}
          </span>
          <button
            className="icon-button"
            aria-label={t("Далее")}
            disabled={!data.hasMore}
            onClick={() => setOffset((value) => value + 100)}
          >
            <ChevronRight size={16} />
          </button>
        </div>
      )}
    </section>
  );
}
