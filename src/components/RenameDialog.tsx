import { useCallback, useRef, useState } from "react";
import { Modal } from "./Modal";
import { api, errorMessage, type RenamePreview } from "../services/api";

export interface RenameRequest {
  vaultId: string;
  path: string;
  revision: string;
  openPaths: string[];
  dirtyPaths: string[];
  suggestedPath?: string;
}
export type ReviewRename = (
  request: RenameRequest,
) => Promise<RenamePreview | null>;

function RenameDialog({
  request,
  finish,
}: {
  request: RenameRequest;
  finish: (result: RenamePreview | null) => void;
}) {
  const [name, setName] = useState(request.suggestedPath ?? request.path);
  const [preview, setPreview] = useState<RenamePreview | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const blocked =
    preview?.affectedOpenPaths.filter((path) =>
      request.dirtyPaths.includes(path),
    ) ?? [];
  const load = async (more = false) => {
    setLoading(true);
    setError("");
    try {
      const result =
        more && preview
          ? await api.renamePage(
              request.vaultId,
              preview.token,
              preview.changes.length,
              request.openPaths,
            )
          : await api.previewRename(
              request.vaultId,
              request.path,
              name.trim(),
              request.revision,
              request.openPaths,
            );
      setPreview(
        more && preview
          ? { ...result, changes: [...preview.changes, ...result.changes] }
          : result,
      );
    } catch (e) {
      setError(errorMessage(e));
      setPreview(null);
    } finally {
      setLoading(false);
    }
  };
  return (
    <Modal
      title="Переименовать заметку"
      onClose={() => {
        if (!loading) finish(null);
      }}
    >
      <form
        className="rename-form"
        onSubmit={(event) => {
          event.preventDefault();
          void load();
        }}
      >
        <p>
          Проверьте новый путь и изменения wiki-ссылок. Родительская папка
          должна существовать.
        </p>
        <label>
          Имя и путь
          <input
            value={name}
            disabled={loading}
            onChange={(event) => {
              setName(event.target.value);
              setPreview(null);
              setError("");
            }}
          />
        </label>
        <button
          className="button secondary"
          type="submit"
          disabled={loading || name.trim() === request.path || !name.trim()}
        >
          Предпросмотр
        </button>
        {error && (
          <p role="alert" className="tree-error">
            {error}
          </p>
        )}
        {preview && (
          <section aria-label="Изменения ссылок">
            <p>
              <strong>
                {preview.from} → {preview.to}
              </strong>
            </p>
            <p>
              Файлов: {preview.files} · Изменений ссылок: {preview.links}
            </p>
            {preview.unresolved > 0 && (
              <p>
                Неразрешённых ссылок: {preview.unresolved}. Их текст сохранится.
              </p>
            )}
            <div className="rename-changes">
              {preview.changes.map((change, index) => (
                <div className="rename-change" key={`${change.path}:${index}`}>
                  <small>
                    {change.path}:{change.line}
                  </small>
                  <code className="rename-before">− {change.before}</code>
                  <code className="rename-after">+ {change.after}</code>
                </div>
              ))}
            </div>
            {preview.hasMore && (
              <button
                type="button"
                disabled={loading}
                onClick={() => void load(true)}
              >
                Ещё изменения
              </button>
            )}
            {!preview.links && <p>Ссылки переписывать не требуется.</p>}
            {blocked.length > 0 && (
              <p role="alert" className="tree-error">
                Сначала сохраните затронутые вкладки: {blocked.join(", ")}.
                Затем откройте предпросмотр заново.
              </p>
            )}
            <p className="rename-hint">
              Перед записью создаются резервные копии. Действие можно отменить в
              панели сведений.
            </p>
          </section>
        )}
        <div className="modal-actions">
          <button
            className="button secondary"
            type="button"
            disabled={loading}
            onClick={() => finish(null)}
          >
            Отмена
          </button>
          <button
            className="button primary"
            type="button"
            disabled={!preview || loading || blocked.length > 0}
            onClick={() => finish(preview)}
          >
            Применить переименование
          </button>
        </div>
      </form>
    </Modal>
  );
}

export function useRenameReview() {
  const [request, setRequest] = useState<RenameRequest | null>(null);
  const resolve = useRef<((result: RenamePreview | null) => void) | null>(null);
  const review = useCallback<ReviewRename>(
    (next) =>
      new Promise((done) => {
        resolve.current?.(null);
        resolve.current = done;
        setRequest(next);
      }),
    [],
  );
  const finish = (result: RenamePreview | null) => {
    resolve.current?.(result);
    resolve.current = null;
    setRequest(null);
  };
  return {
    review,
    dialog: request ? <RenameDialog request={request} finish={finish} /> : null,
  };
}
