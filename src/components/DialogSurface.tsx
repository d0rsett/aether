import { useEffect, useRef, type ReactNode } from "react";

/** Shared native focus trap, Escape handling and focus restoration. */
export function DialogSurface({
  className,
  label,
  labelledBy,
  closeOnSurfaceClick = false,
  onClose,
  children,
}: {
  className: string;
  label?: string;
  labelledBy?: string;
  closeOnSurfaceClick?: boolean;
  onClose: () => void;
  children: ReactNode;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const node = dialog.current;
    const opener = document.activeElement;
    node?.showModal();
    node?.querySelector("input")?.focus();
    return () => {
      node?.close();
      queueMicrotask(() => {
        if (opener instanceof HTMLElement && opener.isConnected)
          opener.focus({ preventScroll: true });
      });
    };
  }, []);
  return (
    <dialog
      ref={dialog}
      className={className}
      aria-label={label}
      aria-labelledby={labelledBy}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        if (event.target !== event.currentTarget) return;
        const rect = event.currentTarget.getBoundingClientRect();
        if (
          closeOnSurfaceClick ||
          event.clientX < rect.left ||
          event.clientX > rect.right ||
          event.clientY < rect.top ||
          event.clientY > rect.bottom
        )
          onClose();
      }}
    >
      {children}
    </dialog>
  );
}
