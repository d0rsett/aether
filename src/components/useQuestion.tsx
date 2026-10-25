import { useCallback, useEffect, useRef, useState } from "react";
import { Modal } from "./Modal";
import type { Ask, Question } from "../app/useWorkspace";

export function useQuestion() {
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
    <Modal title={question.title} onClose={() => answer(null)}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          answer(value);
        }}
      >
        {question.description && (
          <p className="modal-description">{question.description}</p>
        )}
        {question.initial !== undefined && (
          <label className="input-label">
            Имя и путь
            <input
              autoFocus
              value={value}
              onChange={(e) => setValue(e.target.value)}
              onFocus={(e) => e.target.select()}
              required
            />
          </label>
        )}
        <div className="modal-actions">
          <button
            type="button"
            className="button secondary"
            onClick={() => answer(null)}
          >
            Отмена
          </button>
          <button
            autoFocus={question.initial === undefined}
            className={`button ${question.dangerous ? "danger" : "primary"}`}
            type="submit"
          >
            {question.label ?? "Продолжить"}
          </button>
        </div>
      </form>
    </Modal>
  );
  return { ask, dialog };
}
