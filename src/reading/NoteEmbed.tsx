import { t, useLocale } from "../i18n";
import { useEffect, useState, useSyncExternalStore } from "react";
import { FileText, ExternalLink } from "lucide-react";
import { api, type RenderDocument } from "../services/api";
import { NotePreviews } from "../services/notePreviews";
import { renderNode, type RenderContext } from "./ReadingView";
export function NoteEmbed({
  target,
  label,
  context,
  wiki = true,
  preview = false,
}: {
  target: string;
  label: string;
  context: RenderContext;
  wiki?: boolean;
  preview?: boolean;
}) {
  useLocale();
  const [fallback] = useState(() => new NotePreviews());
  const store = context.previews ?? fallback;
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const [attempt, retry] = useState(0);
  const [resolution, setResolution] = useState<{
    path: string;
    key: string;
  } | null>(null);
  const [document, setDocument] = useState<{
    value: RenderDocument;
    content: string;
    path: string;
    key: string;
  } | null>(null);
  const [error, setError] = useState("");
  const anchor = target.includes("#")
    ? target.slice(target.indexOf("#") + 1)
    : "";
  const requestKey = JSON.stringify([
    context.vaultId,
    context.path,
    target,
    wiki,
    attempt,
    snapshot.diskRevision,
  ]);
  const chain = context.embedChain ?? [`${context.path}#`];
  const tooDeep = chain.length >= 5;
  useEffect(() => {
    let disposed = false;
    setResolution(null);
    setDocument(null);
    setError("");
    if (tooDeep) {
      setError(t("Достигнута глубина вложений. Откройте исходную заметку."));
      return;
    }
    const release = store.acquire();
    if (!release) {
      setError(
        t("Слишком много вложенных заметок. Откройте исходную заметку."),
      );
      return;
    }
    void (async () => {
      const destination = wiki
        ? target
        : await api.documentLink(context.vaultId, context.path, target);
      return api.resolve(context.vaultId, context.path, destination);
    })()
      .then((value) => {
        if (disposed) return;
        if (!value.path) {
          setError(
            value.status === "ambiguous"
              ? t("Найдено несколько заметок. Уточните путь в ссылке.")
              : t(
                  "Заметка не найдена. Проверьте ссылку или откройте её, чтобы создать заметку.",
                ),
          );
        } else {
          setResolution({ path: value.path, key: requestKey });
        }
      })
      .catch(() => {
        if (!disposed)
          setError(
            t(
              "Не удалось найти заметку. Проверьте хранилище и повторите попытку.",
            ),
          );
      });
    return () => {
      disposed = true;
      release();
    };
  }, [requestKey, store, tooDeep]);
  const path = resolution?.key === requestKey ? resolution.path : undefined;
  const buffer =
    snapshot.vaultId === context.vaultId && path
      ? snapshot.notes.get(path)
      : undefined;
  const identity = path ? `${path}#${anchor}` : "";
  const cyclic = !!path && chain.includes(identity);
  useEffect(() => {
    if (!path || cyclic) return;
    let disposed = false;
    setDocument(null);
    setError("");
    const timer = window.setTimeout(() => {
      void (async () => {
        const content =
          buffer ?? (await api.read(context.vaultId, path)).content;
        if (disposed) return;
        const value = await api.renderFragment(
          context.vaultId,
          path,
          content,
          anchor,
        );
        if (!disposed) setDocument({ value, content, path, key: requestKey });
      })().catch(() => {
        if (!disposed)
          setError(
            anchor
              ? t(
                  "Не удалось показать фрагмент. Проверьте заголовок или ID блока в исходной заметке.",
                )
              : t(
                  "Не удалось прочитать заметку. Проверьте файл и повторите попытку.",
                ),
          );
      });
    }, 120);
    return () => {
      disposed = true;
      window.clearTimeout(timer);
    };
  }, [path, anchor, buffer, cyclic, requestKey, context.vaultId]);
  const current =
    document?.key === requestKey &&
    document.path === path &&
    (buffer === undefined || buffer === document.content)
      ? document.value
      : null;
  const message = cyclic
    ? t("Циклическое встраивание. Откройте исходную заметку.")
    : error;
  const open = () => {
    if (wiki) context.onWiki(target);
    else
      void api
        .documentLink(context.vaultId, context.path, target)
        .then(context.onWiki)
        .catch(() =>
          context.onError(
            t("Не удалось открыть исходную заметку. Проверьте ссылку."),
          ),
        );
  };
  return (
    <section
      className={`note-transclusion${preview ? " note-hover-content" : ""}`}
      aria-label={t`Встроенная заметка: ${label}`}
    >
      <div className="note-transclusion-header">
        <FileText size={14} />
        <span
          className={preview ? "note-hover-title" : undefined}
          title={preview ? label : undefined}
        >
          {preview
            ? (path ?? target.split("#")[0])
                .split("/")
                .at(-1)
                ?.replace(/\.md$/i, "") || t("Текущая заметка")
            : label}
          {preview && anchor && (
            <small>
              {anchor.startsWith("^") ? t("Блок") : t("Раздел")}:{" "}
              {anchor.replace(/^\^/, "")}
            </small>
          )}
        </span>
        <button
          type="button"
          onClick={open}
          aria-label={t`Открыть оригинал: ${label}`}
          data-tooltip={t("Открыть исходную заметку")}
        >
          <ExternalLink size={14} />
        </button>
      </div>
      {message ? (
        <div className="note-transclusion-message">
          <span>{t(message)}</span>
          {!cyclic && !tooDeep && (
            <button type="button" onClick={() => retry((value) => value + 1)}>
              {t(" Повторить ")}
            </button>
          )}
        </div>
      ) : current && path ? (
        <div className="note-transclusion-body">
          {current.warning && (
            <p className="tree-error">
              {t(" Не удалось разобрать часть свойств исходной заметки. ")}
            </p>
          )}
          {current.nodes.length ? (
            current.nodes.map((node, index) => (
              <div className="note-transclusion-node" key={index}>
                {renderNode(node, {
                  ...context,
                  previews: store,
                  path,
                  onTask: undefined,
                  onFootnote: undefined,
                  table: undefined,
                  tableFor: undefined,
                  embedChain: [...chain, identity],
                  onWiki: (destination) => {
                    if (context.onNavigate)
                      context.onNavigate(path, destination);
                    else
                      void api
                        .resolve(context.vaultId, path, destination)
                        .then((value) => {
                          if (value.path)
                            context.onWiki(
                              value.path +
                                (destination.includes("#")
                                  ? destination.slice(destination.indexOf("#"))
                                  : ""),
                            );
                          else
                            context.onError(
                              t(
                                "Не удалось открыть ссылку из встроенной заметки.",
                              ),
                            );
                        })
                        .catch(() =>
                          context.onError(
                            t(
                              "Не удалось открыть ссылку из встроенной заметки.",
                            ),
                          ),
                        );
                  },
                })}
              </div>
            ))
          ) : (
            <p className="reading-empty">
              {t("В этом фрагменте пока нет текста.")}
            </p>
          )}
        </div>
      ) : (
        <div className="note-transclusion-message" role="status">
          {t(" Загрузка заметки\u2026 ")}
        </div>
      )}
    </section>
  );
}
