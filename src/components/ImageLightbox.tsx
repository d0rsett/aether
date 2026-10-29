import { t, useLocale } from "../i18n";
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
  useLocale();
  return (
    <DialogSurface
      className="image-lightbox"
      closeOnSurfaceClick
      label={t`Просмотр изображения: ${label}`}
      onClose={onClose}
    >
      <img className="lightbox-image" src={src} alt={label} draggable={false} />
      <button
        className="lightbox-close"
        type="button"
        aria-label={t("Закрыть изображение")}
        onClick={onClose}
      >
        <X size={22} />
      </button>
    </DialogSurface>
  );
}
