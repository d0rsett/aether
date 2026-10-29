import { t, useLocale } from "../i18n";
import { useEffect, useRef, useState } from "react";
import { api, errorMessage } from "../services/api";
import { expandTemplate } from "../editor/templates";
import { Modal } from "./Modal";
export function Templates({
  vaultId,
  path,
  content,
  onInsert,
  onClose,
}: {
  vaultId: string;
  path: string;
  content: string;
  onInsert: (text: string) => void;
  onClose: () => void;
}) {
  useLocale();
  const [folder, setFolder] = useState("Templates"),
    [files, setFiles] = useState<string[]>([]),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const [name, setName] = useState("");
  const active = useRef(true);
  useEffect(() => {
    active.current = true;
    void api
      .templateFolder(vaultId)
      .then((value) => {
        if (active.current) setFolder(value || "/");
      })
      .catch(() => {
        if (active.current)
          setError(t("Не удалось прочитать папку шаблонов Obsidian."));
      });
    return () => {
      active.current = false;
    };
  }, [vaultId]);
  useEffect(() => {
    let current = true;
    setFiles([]);
    setError("");
    if (!folder.trim()) return;
    void api
      .list(vaultId, folder === "/" ? "" : folder)
      .then((entries) => {
        if (current)
          setFiles(
            entries
              .filter(
                (entry) => !entry.isDirectory && /\.md$/i.test(entry.path),
              )
              .map((entry) => entry.path),
          );
      })
      .catch(() => {
        if (current)
          setError(
            t(
              "Папка не найдена или недоступна. Укажите папку шаблонов либо сохраните здесь первый шаблон.",
            ),
          );
      });
    return () => {
      current = false;
    };
  }, [vaultId, folder]);
  const insert = async (file: string) => {
    setBusy(true);
    setError("");
    try {
      const note = await api.read(vaultId, file);
      if (!active.current) return;
      onInsert(
        expandTemplate(
          note.content,
          path.split("/").at(-1)?.replace(/\.md$/i, "") ?? "",
        ),
      );
      onClose();
    } catch (reason) {
      if (active.current) setError(errorMessage(reason));
    } finally {
      if (active.current) setBusy(false);
    }
  };
  return (
    <Modal title={t("Шаблоны заметок")} onClose={onClose}>
      <div className="templates-form">
        <label>
          {t(" Папка шаблонов ")}
          <input
            aria-label={t("Папка шаблонов")}
            value={folder}
            disabled={busy}
            onChange={(event) => setFolder(event.target.value)}
          />
        </label>
        <p>
          {t(
            " Вставка в позицию курсора. Свойства шаблона дополняют существующие; совпадающие значения заметки сохраняются. ",
          )}
        </p>
        <p>
          <code>{"{{title}} · {{date}} · {{time}} · {{date:DD.MM.YYYY}}"}</code>
        </p>
        {error && <p role="alert">{t(error)}</p>}
        <div className="templates-list">
          {files.map((file) => (
            <button
              key={file}
              disabled={busy}
              onClick={() => void insert(file)}
            >
              {folder === "/" ? file : file.slice(folder.length + 1)}
            </button>
          ))}
        </div>
        <form
          onSubmit={async (event) => {
            event.preventDefault();
            setBusy(true);
            setError("");
            try {
              if (!name.trim() || /[\\/:*?"<>|]/.test(name))
                throw new Error(
                  t("Введите имя шаблона без специальных символов."),
                );
              const parts = folder === "/" ? [] : folder.split("/");
              let prefix = "";
              for (const part of parts) {
                prefix += (prefix ? "/" : "") + part;
                try {
                  await api.list(vaultId, prefix);
                } catch {
                  await api.mkdir(vaultId, prefix);
                }
              }
              const file = `${folder === "/" ? "" : `${folder}/`}${name.trim().replace(/\.md$/i, "")}.md`;
              await api.create(vaultId, file, content);
              if (active.current) {
                setFiles((previous) => [...previous, file]);
                setName("");
                setError("");
              }
            } catch (reason) {
              if (active.current) setError(errorMessage(reason));
            } finally {
              if (active.current) setBusy(false);
            }
          }}
        >
          <label>
            {t(" Сохранить текущую заметку как шаблон ")}
            <input
              aria-label={t("Имя шаблона")}
              value={name}
              disabled={busy}
              onChange={(event) => setName(event.target.value)}
              required
            />
          </label>
          <button type="submit" disabled={busy}>
            {t(" Сохранить шаблон ")}
          </button>
        </form>
      </div>
    </Modal>
  );
}
