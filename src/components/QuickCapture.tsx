import { useRef, useState } from "react";
import { CornerDownLeft, Inbox } from "lucide-react";
import { Modal } from "./Modal";
import { t } from "../i18n";

const key = (vaultId: string) => "aether.capture.v1:" + vaultId;
export function QuickCapture({
  vaultId,
  save,
  onClose,
}: {
  vaultId: string;
  save: (text: string) => Promise<string | undefined>;
  onClose: () => void;
}) {
  const submit = useRef<HTMLButtonElement>(null);
  const [text, setText] = useState(() => {
    try {
      return localStorage.getItem(key(vaultId)) ?? "";
    } catch {
      return "";
    }
  });
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const store = (value: string) => {
    try {
      localStorage.setItem(key(vaultId), value);
      return true;
    } catch {
      setError(t("Не удалось сохранить черновик захвата."));
      return false;
    }
  };
  return (
    <Modal
      title={t("Быстрый захват")}
      className="quick-capture"
      onClose={() => {
        if (!saving && store(text)) onClose();
      }}
      actions={
        <>
          <span className="capture-destination">
            <Inbox size={15} />
            {t("Входящие")}
          </span>
          <button
            ref={submit}
            type="button"
            className="button primary"
            disabled={saving || !text.trim()}
            onClick={async () => {
              setSaving(true);
              setError("");
              try {
                if (await save(text)) {
                  setText("");
                  if (store("")) onClose();
                } else {
                  setError(
                    t(
                      "Не удалось сохранить заметку. Текст сохранён в окне захвата.",
                    ),
                  );
                }
              } catch {
                setError(
                  t(
                    "Не удалось сохранить заметку. Текст сохранён в окне захвата.",
                  ),
                );
              } finally {
                setSaving(false);
              }
            }}
          >
            {saving ? t("Сохранение…") : t("Сохранить во входящие")}
            <CornerDownLeft size={14} aria-hidden="true" />
          </button>
        </>
      }
    >
      <p className="modal-description">
        {t("Сохраните мысль, не переключаясь с текущей заметки.")}
      </p>
      <textarea
        className="capture-text"
        placeholder={t("Что хочется сохранить?")}
        onKeyDown={(event) => {
          if (
            event.key === "Enter" &&
            (event.metaKey || event.ctrlKey) &&
            !event.nativeEvent.isComposing
          ) {
            event.preventDefault();
            submit.current?.click();
          }
        }}
        data-dialog-focus
        aria-label={t("Текст мысли")}
        value={text}
        disabled={saving}
        onChange={(event) => {
          const value = event.currentTarget.value;
          setText(value);
          store(value);
        }}
      />
      <p className="capture-hint">
        {t("Черновик можно закрыть и продолжить позже.")}
        <kbd>{import.meta.env.AETHER_MACOS ? "⌘" : "Ctrl"} ↵</kbd>
      </p>
      {error && (
        <p role="alert" className="tree-error">
          {error}
        </p>
      )}
    </Modal>
  );
}
