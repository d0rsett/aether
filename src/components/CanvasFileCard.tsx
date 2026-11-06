import { ExternalLink } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { t } from "../i18n";
import { LocalMedia } from "../reading/LocalMedia";
import { NoteEmbed } from "../reading/NoteEmbed";
import { LocalImage, type RenderContext } from "../reading/ReadingView";
import {
  canvasFilePath,
  canvasFileTarget,
  markdownFile,
  mediaFile,
} from "../services/canvasFiles";
import { imageExtension } from "../services/images";

export interface CanvasFiles {
  context: RenderContext;
  open: (path: string, subpath?: string) => void;
  saveNote?: (path: string) => void;
  edit?: (path: string) => Promise<boolean>;
  editor?: (path: string) => React.ReactNode;
  convert?: (text: string) => Promise<string | undefined>;
  importFiles?: (files: File[]) => Promise<string[]>;
  requestUrl?: (initial?: string) => Promise<string | null>;
}

export function CanvasFileCard({
  file,
  subpath,
  files,
}: {
  file: string;
  subpath?: string;
  files: CanvasFiles;
}) {
  const preview = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const node = preview.current;
    if (!node) return;
    if (typeof IntersectionObserver === "undefined") {
      setVisible(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        setVisible(entries.some((entry) => entry.isIntersecting));
      },
      { rootMargin: "100px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  if (!canvasFilePath(file))
    return <p role="alert">{t("Некорректный путь к файлу.")}</p>;

  const image = imageExtension(file);
  const name = file.split("/").at(-1) || file;
  const note = markdownFile.test(file);
  const target = canvasFileTarget(file);
  // The shared attachment loader expects a Markdown origin. The rooted target
  // selects this exact file regardless of the board's folder.
  const context = { ...files.context, path: "__canvas_preview__.md" };
  return (
    <div ref={preview} className="canvas-file-preview">
      {note && visible ? (
        <NoteEmbed
          target={subpath ?? ""}
          label={name}
          exactFile={{ path: file, open: () => files.open(file, subpath) }}
          context={files.context}
        />
      ) : (
        <>
          <div className="canvas-file-header" title={file}>
            <span>{name}</span>
            <button
              type="button"
              className="icon-button"
              aria-label={t("Открыть файл карточки")}
              onClick={() => files.open(file, subpath)}
            >
              <ExternalLink size={14} />
            </button>
          </div>
          {visible && image && (
            <LocalImage
              target={target}
              alt={name}
              caption=""
              wiki
              context={context}
            />
          )}
          {visible && !image && mediaFile.test(file) && (
            <LocalMedia target={target} wiki context={context} />
          )}
        </>
      )}
    </div>
  );
}
