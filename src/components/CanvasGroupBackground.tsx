import { useEffect, useRef, useState } from "react";
import { t } from "../i18n";
import { api } from "../services/api";
import { canvasFileTarget } from "../services/canvasFiles";

export function CanvasGroupBackground({
  vaultId,
  path,
  mode,
}: {
  vaultId: string;
  path: string;
  mode: "cover" | "ratio" | "repeat";
}) {
  const element = useRef<HTMLDivElement>(null);
  const [image, setImage] = useState("");
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let cancelled = false;
    let observer: IntersectionObserver | undefined;
    setImage("");
    setFailed(false);
    const load = () => {
      void api
        .readImage(
          vaultId,
          "__canvas_preview__.md",
          canvasFileTarget(path),
          true,
        )
        .then((value) => {
          if (!cancelled) setImage(value);
        })
        .catch(() => {
          if (!cancelled) setFailed(true);
        });
    };
    if (element.current && typeof IntersectionObserver !== "undefined") {
      observer = new IntersectionObserver((entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        observer?.disconnect();
        load();
      });
      observer.observe(element.current);
    } else load();
    return () => {
      cancelled = true;
      observer?.disconnect();
    };
  }, [vaultId, path]);
  return (
    <div
      ref={element}
      className={`canvas-group-background canvas-group-background-${mode}`}
      style={image ? { backgroundImage: `url("${image}")` } : undefined}
    >
      {failed && (
        <span role="status">{t("Не удалось загрузить фон группы.")}</span>
      )}
    </div>
  );
}
