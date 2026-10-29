import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  ExternalLink,
  Image as ImageIcon,
  LoaderCircle,
  X,
} from "lucide-react";
import { ImageLightbox } from "../components/ImageLightbox";
import { api, errorMessage } from "../services/api";
import type { RenderContext } from "./ReadingView";
import { LoadedMedia } from "./LocalMedia";
import "../styles/external-media.css";

export type ExternalKind = "image" | "audio" | "video" | "pdf";
export function externalKind(target: string): ExternalKind {
  let path = "";
  try {
    path = new URL(target).pathname.toLowerCase();
  } catch {
    return "image";
  }
  if (/\.pdf$/.test(path)) return "pdf";
  if (/\.(mp3|wav|ogg|m4a|flac)$/.test(path)) return "audio";
  if (/\.(mp4|webm|mov|mkv|ogv|3gp)$/.test(path)) return "video";
  return "image";
}

export function ExternalMedia({
  target,
  alt,
  kind,
  context,
}: {
  target: string;
  alt: string;
  kind: ExternalKind;
  context: RenderContext;
}) {
  const [requested, setRequested] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<{ mime: string; data: string } | null>(
    null,
  );
  const [error, setError] = useState("");
  const [expanded, setExpanded] = useState(false);
  const imageButton = useRef<HTMLButtonElement>(null);
  const name = (() => {
    try {
      return new URL(target).hostname;
    } catch {
      return "Внешний источник";
    }
  })();
  const parts = alt.split("|");
  const dimensions = /^(\d+)(?:x(\d+))?$/.exec(parts.at(-1)?.trim() || "");
  const description = (dimensions ? parts.slice(0, -1).join("|") : alt).trim();
  const label = description || `Изображение: ${name}`;
  const src =
    result && kind === "image"
      ? `data:${result.mime};base64,${result.data}`
      : "";
  useEffect(() => {
    let cancelled = false;
    setResult(null);
    setError("");
    if (requested)
      void api
        .readExternalMedia(context.vaultId, target, kind)
        .then((value) => {
          if (!cancelled) setResult(value);
        })
        .catch((reason) => {
          if (!cancelled) setError(errorMessage(reason));
        });
    return () => {
      cancelled = true;
    };
  }, [requested, attempt, context.vaultId, target, kind]);
  return (
    <span className={`external-embed external-${kind}`}>
      <span className="external-embed-header">
        <ImageIcon size={16} aria-hidden="true" />
        <span className="external-origin">
          {kind === "image"
            ? "Изображение"
            : kind === "pdf"
              ? "PDF"
              : kind === "audio"
                ? "Аудио"
                : "Видео"}{" "}
          · {name}
        </span>
        {requested && (
          <button
            type="button"
            className="external-action-icon"
            aria-label="Скрыть внешнее вложение"
            title="Скрыть"
            onClick={() => {
              setExpanded(false);
              setRequested(false);
            }}
          >
            <X size={15} aria-hidden="true" />
          </button>
        )}
      </span>
      {!requested ? (
        <button
          type="button"
          className="external-load"
          onClick={() => setRequested(true)}
        >
          Загрузить{" "}
          {kind === "image"
            ? "изображение"
            : kind === "audio"
              ? "аудио"
              : kind === "video"
                ? "видео"
                : "PDF"}
        </button>
      ) : error ? (
        <span role="alert" className="external-error">
          {error}{" "}
          <button type="button" onClick={() => setAttempt((n) => n + 1)}>
            Повторить
          </button>
        </span>
      ) : result ? (
        kind === "image" ? (
          <>
            <button
              ref={imageButton}
              type="button"
              className="image-open"
              aria-label={`Открыть изображение: ${label}`}
              onClick={() => setExpanded(true)}
            >
              <img
                src={src}
                alt={label}
                style={
                  dimensions
                    ? {
                        width: Math.min(Number(dimensions[1]), 8192),
                        height: dimensions[2]
                          ? Math.min(Number(dimensions[2]), 8192)
                          : undefined,
                        objectFit: "contain",
                      }
                    : undefined
                }
              />
            </button>
            {description && (
              <span className="image-caption">{description}</span>
            )}
            {expanded &&
              createPortal(
                <ImageLightbox
                  label={label}
                  src={src}
                  onClose={() => {
                    setExpanded(false);
                    imageButton.current?.focus();
                  }}
                />,
                document.body,
              )}
          </>
        ) : (
          <LoadedMedia {...result} target={target} />
        )
      ) : (
        <span role="status" className="external-status">
          <LoaderCircle size={15} /> Загрузка…
        </span>
      )}
    </span>
  );
}

// A remote page is never mounted as an iframe in the application. Opening it is
// an explicit navigation in the user's browser, separate from media downloads.
export function ExternalPage({
  target,
  context,
}: {
  target: string;
  context: RenderContext;
}) {
  const host = (() => {
    try {
      return new URL(target).hostname;
    } catch {
      return "Внешняя страница";
    }
  })();
  return (
    <span className="external-embed external-page">
      <span className="external-embed-header">
        <ExternalLink size={16} aria-hidden="true" />
        <span className="external-origin">Внешняя страница · {host}</span>
      </span>
      <button
        type="button"
        className="external-load"
        onClick={() => {
          void api
            .openExternal(target)
            .catch((reason) => context.onError(errorMessage(reason)));
        }}
      >
        Открыть в браузере
      </button>
    </span>
  );
}
