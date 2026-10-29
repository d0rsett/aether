import { t, useLocale } from "../i18n";
import { useEffect, useRef, useState, type ReactNode } from "react";
export function InlineFootnote({
  number,
  children,
}: {
  number: number;
  children: ReactNode;
}) {
  useLocale();
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLSpanElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !root.current?.contains(event.target))
        setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setOpen(false);
        button.current?.focus();
      }
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);
  return (
    <span className="inline-footnote" ref={root}>
      <sup>
        <button
          ref={button}
          type="button"
          aria-label={t`Показать встроенную сноску ${number}`}
          aria-expanded={open}
          onClick={() => setOpen(!open)}
        >
          {number}
        </button>
      </sup>
      {open && (
        <span className="inline-footnote-content" role="note">
          {children}
        </span>
      )}
    </span>
  );
}
