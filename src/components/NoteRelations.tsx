import {
  ArrowDownLeft,
  ArrowUpRight,
  ChevronRight,
  Hash,
  Link2,
  Plus,
} from "lucide-react";
import type { Inspection } from "../services/api";
import type { MouseEvent } from "react";
import { groupRelations } from "../services/relations";

export function NoteRelations({
  data,
  onOpen,
  onWiki,
  onContext,
}: {
  data: Inspection | null;
  onOpen: (path: string) => void;
  onWiki: (target: string) => void;
  onContext?: (event: MouseEvent<HTMLElement>, path: string) => void;
}) {
  if (!data) return <p className="relations-hint">Подготовка сведений…</p>;
  const { incoming, outgoing } = groupRelations(data);
  return (
    <div
      className="note-relations"
      data-tooltip="Связи по сохранённой версии заметки"
    >
      {data.metadata.warning && (
        <p className="tree-error">{data.metadata.warning}</p>
      )}
      {!!data.metadata.tags.length && (
        <div className="note-tags">
          {data.metadata.tags.map((tag) => (
            <span key={tag}>
              <Hash size={10} />
              {tag}
            </span>
          ))}
        </div>
      )}
      {!!Object.keys(data.metadata.properties).length && (
        <details className="frontmatter-properties">
          <summary>Свойства</summary>
          {Object.entries(data.metadata.properties).map(([key, value]) => (
            <div key={key}>
              <span>{key}</span>
              <code>
                {typeof value === "string" ? value : JSON.stringify(value)}
              </code>
            </div>
          ))}
        </details>
      )}
      <details className="relations-section" open>
        <summary className="relations-heading">
          <ChevronRight
            className="relations-chevron"
            size={12}
            aria-hidden="true"
          />
          <ArrowDownLeft size={13} />
          <span>Обратные ссылки</span>
          <small>{incoming.length}</small>
        </summary>
        {incoming.length ? (
          incoming.map((link) => (
            <button
              className="relation-link"
              key={link.path}
              data-tooltip={`${link.path}:${link.line}`}
              onClick={() => onOpen(link.path)}
              onContextMenu={(event) => onContext?.(event, link.path)}
            >
              <Link2 size={12} />
              <span>
                {link.title}
                <small>
                  {link.path} · строка {link.line}
                </small>
              </span>
              {link.mentions > 1 && (
                <span
                  className="relation-repeat-count"
                  aria-label={`Упоминаний: ${link.mentions}`}
                  data-tooltip={`Упоминаний: ${link.mentions}`}
                >
                  ×{link.mentions}
                </span>
              )}
            </button>
          ))
        ) : (
          <p className="relations-hint">Пока нет обратных ссылок</p>
        )}
      </details>
      <details className="relations-section" open>
        <summary className="relations-heading">
          <ChevronRight
            className="relations-chevron"
            size={12}
            aria-hidden="true"
          />
          <ArrowUpRight size={13} />
          <span>Исходящие ссылки</span>
          <small>{outgoing.length}</small>
        </summary>
        {outgoing.length ? (
          outgoing.map((link, index) => (
            <div key={`${link.target}:${index}`}>
              <button
                className={`relation-link ${link.resolution.status === "missing" ? "missing-link" : ""}`}
                data-tooltip={[
                  link.resolution.status === "missing"
                    ? "Создать связанную заметку"
                    : link.resolution.path || link.target,
                  ...link.aliases,
                ].join("\n")}
                onContextMenu={(event) => {
                  if (link.resolution.path)
                    onContext?.(event, link.resolution.path);
                }}
                onClick={() =>
                  onWiki(link.target + (link.anchor ? `#${link.anchor}` : ""))
                }
              >
                {link.resolution.status === "missing" ? (
                  <Plus size={12} />
                ) : (
                  <Link2 size={12} />
                )}
                <span>
                  {link.alias ?? link.target}
                  {link.anchor && <small>#{link.anchor}</small>}
                  {link.resolution.status === "ambiguous" && (
                    <small>Уточните путь</small>
                  )}
                </span>
                {link.mentions > 1 && (
                  <span
                    className="relation-repeat-count"
                    aria-label={`Упоминаний: ${link.mentions}`}
                    data-tooltip={`Упоминаний: ${link.mentions}`}
                  >
                    ×{link.mentions}
                  </span>
                )}
              </button>
              {link.resolution.candidates.map((path) => (
                <button
                  className="relation-candidate"
                  key={path}
                  onContextMenu={(event) => onContext?.(event, path)}
                  onClick={() =>
                    onWiki(path + (link.anchor ? `#${link.anchor}` : ""))
                  }
                >
                  {path}
                </button>
              ))}
            </div>
          ))
        ) : (
          <p className="relations-hint">Добавьте [[Название заметки]]</p>
        )}
      </details>
    </div>
  );
}
