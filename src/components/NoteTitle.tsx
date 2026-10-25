import { useEffect, useRef, useState } from "react";
import { titleOf } from "../workspace/model";

export function NoteTitle({
  path,
  disabled,
  rename,
  onError,
  focusRequest,
}: {
  path: string;
  disabled: boolean;
  rename: (path: string, proposed: string) => Promise<unknown>;
  onError: (text: string) => void;
  focusRequest?: number;
}) {
  const original = titleOf(path);
  const [value, setValue] = useState(original);
  const input = useRef<HTMLInputElement>(null);
  const submitting = useRef(false);
  const cancelBlur = useRef(false);
  const focused = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (
      focusRequest === undefined ||
      disabled ||
      focused.current === focusRequest
    )
      return;
    const frame = requestAnimationFrame(() => {
      focused.current = focusRequest;
      input.current?.focus();
      input.current?.select();
    });
    return () => cancelAnimationFrame(frame);
  }, [focusRequest, disabled]);
  const commit = () => {
    if (submitting.current || disabled) return;
    const name = value.trim();
    if (name === original) return;
    if (!name || /[\\/]/.test(name)) {
      onError("Укажите имя заметки без разделителей пути.");
      return;
    }
    const slash = path.lastIndexOf("/");
    const extension = path.match(/\.(md|markdown)$/i)?.[0] ?? ".md";
    const proposed =
      path.slice(0, slash + 1) +
      name.replace(/\.(md|markdown)$/i, "") +
      extension;
    submitting.current = true;
    void rename(path, proposed).finally(() => {
      submitting.current = false;
    });
  };
  return (
    <div className="note-title">
      <input
        ref={input}
        aria-label="Название заметки"
        title="Название заметки · Enter — переименовать, Escape — отменить"
        value={value}
        disabled={disabled}
        spellCheck={false}
        onChange={(event) => setValue(event.target.value)}
        onBlur={() => {
          if (cancelBlur.current) {
            cancelBlur.current = false;
            return;
          }
          commit();
        }}
        onKeyDown={(event) => {
          if (event.nativeEvent.isComposing) return;
          if (event.key === "Escape") {
            event.preventDefault();
            setValue(original);
            cancelBlur.current = true;
            event.currentTarget.blur();
          }
          if (event.key !== "Enter") return;
          event.preventDefault();
          commit();
        }}
      />
    </div>
  );
}
