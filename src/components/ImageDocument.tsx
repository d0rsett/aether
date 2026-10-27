import { useEffect, useState } from "react";
import { FolderOpen, Image as ImageIcon, LoaderCircle } from "lucide-react";
import { api, errorMessage } from "../services/api";
import { imageExtension } from "../services/images";

export function ImageDocument({
  vaultId,
  path,
  onError,
}: {
  vaultId: string;
  path: string;
  onError: (message: string) => void;
}) {
  const [src, setSrc] = useState("");
  const [error, setError] = useState("");
  const [dimensions, setDimensions] = useState("");
  useEffect(() => {
    let cancelled = false;
    setSrc("");
    setError("");
    setDimensions("");
    void api
      .readImage(
        vaultId,
        "__preview__.md",
        "/" + path.split("/").map(encodeURIComponent).join("/"),
        true,
      )
      .then((value) => {
        if (!cancelled) setSrc(value);
      })
      .catch((reason) => {
        if (!cancelled) setError(errorMessage(reason));
      });
    return () => {
      cancelled = true;
    };
  }, [vaultId, path]);
  return (
    <section className="image-document" aria-label={`Изображение: ${path}`}>
      <div className="document-toolbar image-document-header">
        <div className="breadcrumbs">
          <ImageIcon size={15} />
          <span>{path}</span>
        </div>
        <div className="document-actions">
          {dimensions && <span className="image-dimensions">{dimensions}</span>}
          <span className="image-format">{imageExtension(path)}</span>
          <button
            className="icon-button"
            aria-label="Показать изображение в проводнике"
            data-tooltip="Показать в проводнике"
            onClick={() =>
              void api
                .reveal(vaultId, path)
                .catch((reason) => onError(errorMessage(reason)))
            }
          >
            <FolderOpen size={16} />
          </button>
        </div>
      </div>
      <div className="image-document-canvas">
        {error ? (
          <p className="tree-error" role="alert">
            {error}
          </p>
        ) : src ? (
          <img
            src={src}
            alt={path.split("/").at(-1)}
            draggable={false}
            onLoad={(event) =>
              setDimensions(
                `${event.currentTarget.naturalWidth} × ${event.currentTarget.naturalHeight}`,
              )
            }
          />
        ) : (
          <LoaderCircle
            size={22}
            className="spin"
            aria-label="Загрузка изображения"
          />
        )}
      </div>
    </section>
  );
}
