import { useId, type ReactNode } from "react";
import { X } from "lucide-react";
import { DialogSurface } from "./DialogSurface";

export function Modal({
  title,
  onClose,
  children,
  className = "",
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  className?: string;
}) {
  const titleId = useId();
  return (
    <DialogSurface
      className={`modal ${className}`.trim()}
      labelledBy={titleId}
      onClose={onClose}
    >
      <div className="modal-header">
        <h2 id={titleId}>{title}</h2>
        <button
          className="icon-button"
          aria-label="Закрыть диалог"
          type="button"
          onClick={onClose}
        >
          <X size={18} />
        </button>
      </div>
      <div className="modal-body">{children}</div>
    </DialogSurface>
  );
}
