import { t } from "../i18n";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { Modal } from "./Modal";
import type { Ask, Question } from "../app/useWorkspace";
export function useQuestion() {
  const formId = useId();
  const [question, setQuestion] = useState<Question | null>(null);
  const [value, setValue] = useState("");
  const pending = useRef<((answer: string | null) => void) | null>(null);
  const ask: Ask = useCallback((options) => {
    pending.current?.(null);
    setQuestion(options);
    setValue(options.initial ?? "");
    return new Promise((resolve) => {
      pending.current = resolve;
    });
  }, []);
  useEffect(() => () => pending.current?.(null), []);
  const answer = (result: string | null) => {
    pending.current?.(result);
    pending.current = null;
    setQuestion(null);
  };
  const dialog = question && (
    <Modal
      title={question.title}
      onClose={() => answer(null)}
      actions={
        <>
          <button
            type="button"
            className="button secondary"
            data-dialog-focus={
              question.dangerous && question.initial === undefined
                ? ""
                : undefined
            }
            onClick={() => answer(null)}
          >
            {t(" Отмена ")}
          </button>
          <button
            data-dialog-focus={
              !question.dangerous && question.initial === undefined
                ? ""
                : undefined
            }
            className={`button ${question.dangerous ? "danger" : "primary"}`}
            type="submit"
            form={formId}
          >
            {t(question.label ?? "Продолжить")}
          </button>
        </>
      }
    >
      <form
        id={formId}
        onSubmit={(e) => {
          e.preventDefault();
          answer(value);
        }}
      >
        {question.description && (
          <p className="modal-description">{t(question.description)}</p>
        )}
        {question.initial !== undefined && (
          <label className="input-label">
            {t(" Имя и путь ")}
            <input
              autoFocus
              value={value}
              onChange={(e) => setValue(e.target.value)}
              onFocus={(e) => e.target.select()}
              required
            />
          </label>
        )}
      </form>
    </Modal>
  );
  return { ask, dialog };
}
