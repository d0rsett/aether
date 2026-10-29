import { t, useLocale } from "../i18n";
import { useEffect, useState } from "react";
import {
  ChevronRight,
  FileText,
  Image as ImageIcon,
  Paperclip,
} from "lucide-react";
import { api, errorMessage } from "../services/api";
import {
  collectAttachments,
  type AttachmentReference,
} from "../services/attachments";
import { imageExtension } from "../services/images";
import { useContextMenu } from "./ContextMenu";
interface Attachment extends AttachmentReference {
  path: string | null;
  error: string;
}
export function NoteAttachments({
  vaultId,
  path,
  content,
  refresh,
  onOpen,
  onError,
}: {
  vaultId: string;
  path: string;
  content: string;
  refresh: number;
  onOpen: (path: string) => void;
  onError: (message: string) => void;
}) {
  useLocale();
  const key = `${vaultId}\0${path}`;
  const [state, setState] = useState<{
    key: string;
    items: Attachment[];
    error: string;
  } | null>(null);
  const context = useContextMenu(onError);
  useEffect(() => {
    let disposed = false;
    const timer = window.setTimeout(() => {
      void api
        .renderMarkdown(vaultId, path, content)
        .then(async (document) => {
          const references = collectAttachments(document.nodes);
          const resolved = await Promise.all(
            references.map(async (reference) => {
              try {
                return {
                  ...reference,
                  path: await api.resolveAttachment(
                    vaultId,
                    path,
                    reference.target,
                    reference.wiki,
                  ),
                  error: "",
                };
              } catch (error) {
                return { ...reference, path: null, error: errorMessage(error) };
              }
            }),
          );
          const unique = new Map<string, Attachment>();
          for (const item of resolved) {
            const id = (item.path || item.target).toLowerCase();
            const previous = unique.get(id);
            if (!previous || (!previous.label && item.label))
              unique.set(id, item);
          }
          if (!disposed)
            setState({ key, items: [...unique.values()], error: "" });
        })
        .catch((error) => {
          if (!disposed)
            setState({ key, items: [], error: errorMessage(error) });
        });
    }, 180);
    return () => {
      disposed = true;
      window.clearTimeout(timer);
    };
  }, [key, vaultId, path, content, refresh]);
  const current = state?.key === key ? state : null;
  const items = current?.items ?? [];
  const open = (item: Attachment) => {
    if (!item.path) return;
    if (imageExtension(item.path)) onOpen(item.path);
    else
      void api
        .reveal(vaultId, item.path)
        .catch((error) => onError(errorMessage(error)));
  };
  return (
    <>
      <details className="relations-section note-attachments" open>
        <summary className="relations-heading">
          <ChevronRight
            className="relations-chevron"
            size={12}
            aria-hidden="true"
          />
          <Paperclip size={13} aria-hidden="true" />
          <span>{t("Вложения")}</span>
          <small>{items.length}</small>
        </summary>
        {!current ? (
          <p className="relations-hint">{t("Загрузка вложений\u2026")}</p>
        ) : current.error ? (
          <p className="tree-error" role="alert">
            {t(current.error)}
          </p>
        ) : !items.length ? (
          <p className="relations-hint">
            {t("В этой заметке пока нет вложений")}
          </p>
        ) : (
          items.map((item) => {
            const filename = (item.path || item.target).split("/").at(-1)!;
            return (
              <button
                key={item.path || item.target}
                type="button"
                className="relation-link attachment-link"
                aria-label={t`Вложение: ${item.label || filename}`}
                disabled={!item.path}
                data-tooltip={item.error || item.path || item.target}
                onClick={() => open(item)}
                onContextMenu={(event) => {
                  if (!item.path) return;
                  context.show(event, t("Действия с вложением"), [
                    {
                      label: imageExtension(item.path)
                        ? t("Открыть изображение")
                        : t("Открыть в проводнике"),
                      run: () => open(item),
                    },
                    {
                      label: t("Копировать путь"),
                      run: () => navigator.clipboard.writeText(item.path!),
                    },
                    {
                      label: t("Показать в проводнике"),
                      run: () => api.reveal(vaultId, item.path!),
                    },
                  ]);
                }}
              >
                {imageExtension(item.path || item.target) ? (
                  <ImageIcon size={14} aria-hidden="true" />
                ) : (
                  <FileText size={14} aria-hidden="true" />
                )}
                <span className="attachment-link-label">
                  {item.label || filename}
                  <small>{item.path || t("Файл не найден")}</small>
                </span>
                <span className="attachment-type" aria-hidden="true">
                  {item.extension}
                </span>
              </button>
            );
          })
        )}
      </details>
      {context.menu}
    </>
  );
}
