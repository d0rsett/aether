import { t, useLocale } from "../i18n";
import { useCallback, useEffect, useRef, useState } from "react";
import { FolderOpen } from "lucide-react";
import { api, errorMessage } from "../services/api";
import { Modal } from "./Modal";
export type VaultOptions = {
  name: string;
  parent: string;
};
export type RequestVault = () => Promise<VaultOptions | null>;
function CreateVaultDialog({
  onAnswer,
}: {
  onAnswer: (value: VaultOptions | null) => void;
}) {
  useLocale();
  const [name, setName] = useState(t("Мои заметки"));
  const [parent, setParent] = useState("");
  const [picking, setPicking] = useState(false);
  const [error, setError] = useState("");
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const browse = async () => {
    setPicking(true);
    setError("");
    try {
      const selected = await api.chooseVaultParent();
      if (mounted.current && selected) setParent(selected);
    } catch (e) {
      if (mounted.current) setError(errorMessage(e));
    } finally {
      if (mounted.current) setPicking(false);
    }
  };
  return (
    <Modal title={t("Новое хранилище")} onClose={() => onAnswer(null)}>
      <form
        className="vault-form"
        onSubmit={(event) => {
          event.preventDefault();
          if (picking) return;
          if (!name.trim() || /[\\/]/.test(name)) {
            setError(t("Введите имя папки без пути."));
            return;
          }
          onAnswer({ name: name.trim(), parent: parent.trim() });
        }}
      >
        <label className="input-label">
          {t(" Название хранилища ")}
          <input
            required
            value={name}
            onChange={(event) => setName(event.target.value)}
            onFocus={(event) => event.target.select()}
          />
        </label>
        <div className="input-label">
          <label htmlFor="vault-parent-path">{t("Расположение")}</label>
          <span className="vault-location">
            <input
              id="vault-parent-path"
              required
              value={parent}
              onChange={(event) => setParent(event.target.value)}
              placeholder={t("Введите путь или выберите папку")}
            />
            <button
              type="button"
              className="button secondary"
              disabled={picking}
              onClick={() => void browse()}
              aria-label={t("Выбрать папку")}
            >
              <FolderOpen size={16} />
              {t(" Обзор\u2026 ")}
            </button>
          </span>
        </div>
        <p className="modal-description">
          {t(
            " В выбранной папке будет создана новая папка с названием хранилища. ",
          )}
        </p>
        {error && (
          <p role="alert" className="tree-error">
            {t(error)}
          </p>
        )}
        <div className="modal-actions">
          <button
            type="button"
            className="button secondary"
            onClick={() => onAnswer(null)}
          >
            {t(" Отмена ")}
          </button>
          <button
            type="submit"
            className="button primary"
            disabled={picking || !name.trim() || !parent.trim()}
          >
            {t(" Создать хранилище ")}
          </button>
        </div>
      </form>
    </Modal>
  );
}
export function useVaultCreation() {
  const [open, setOpen] = useState(false);
  const pending = useRef<((value: VaultOptions | null) => void) | null>(null);
  const request: RequestVault = useCallback(() => {
    pending.current?.(null);
    setOpen(true);
    return new Promise((resolve) => {
      pending.current = resolve;
    });
  }, []);
  useEffect(() => () => pending.current?.(null), []);
  const answer = (value: VaultOptions | null) => {
    pending.current?.(value);
    pending.current = null;
    setOpen(false);
  };
  return {
    request,
    dialog: open ? <CreateVaultDialog onAnswer={answer} /> : null,
  };
}
