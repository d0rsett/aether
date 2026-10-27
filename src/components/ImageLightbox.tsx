import { X } from "lucide-react";
import { DialogSurface } from "./DialogSurface";

export function ImageLightbox({
  src,
  label,
  onClose,
}: {
  src: string;
  label: string;
  onClose: () => void;
}) {
  return (
    <DialogSurface
      className="image-lightbox"
      closeOnSurfaceClick
      label={`Просмотр изображения: ${label}`}
      onClose={onClose}
    >
      <img className="lightbox-image" src={src} alt={label} draggable={false} />
      <button
        className="lightbox-close"
        type="button"
        aria-label="Закрыть изображение"
        onClick={onClose}
      >
        <X size={22} />
      </button>
    </DialogSurface>
  );
}
