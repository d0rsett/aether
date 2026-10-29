import { lazy, Suspense, useEffect, useRef, useState } from "react";
import {
  FileAudio,
  FileVideo,
  FileText,
  FolderOpen,
  Play,
  Pause,
  Volume2,
  VolumeX,
  X,
} from "lucide-react";
import { api, errorMessage } from "../services/api";
import type { RenderContext } from "./ReadingView";
const PdfView = lazy(() =>
  import("./PdfView").then((module) => ({ default: module.PdfView })),
);
export const mediaTarget =
  /\.(pdf|mp3|wav|ogg|m4a|flac|3gp|mp4|webm|mov|mkv|ogv)(?:#|$)/i;

function AudioPlayer({
  url,
  target,
  onError,
}: {
  url: string;
  target: string;
  onError: () => void;
}) {
  const audio = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [muted, setMuted] = useState(false);
  const format = (value: number) =>
    `${Math.floor(value / 60)}:${String(Math.floor(value % 60)).padStart(2, "0")}`;
  return (
    <span className="audio-player">
      <audio
        ref={audio}
        preload="metadata"
        src={url || undefined}
        aria-label={`Аудио: ${target}`}
        onError={() => {
          if (url) onError();
        }}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
        onTimeUpdate={(event) => setTime(event.currentTarget.currentTime)}
        onDurationChange={(event) =>
          setDuration(
            Number.isFinite(event.currentTarget.duration)
              ? event.currentTarget.duration
              : 0,
          )
        }
      />
      <button
        type="button"
        className="audio-play"
        aria-label={playing ? "Пауза" : "Воспроизвести"}
        onClick={() => {
          const player = audio.current;
          if (!player || !url) return;
          if (player.paused) void player.play().catch(onError);
          else player.pause();
        }}
      >
        {playing ? <Pause size={16} /> : <Play size={16} />}
      </button>
      <span className="audio-time">{format(time)}</span>
      <input
        type="range"
        aria-label="Позиция воспроизведения"
        min={0}
        max={duration || 0}
        step="any"
        value={Math.min(time, duration)}
        disabled={!duration}
        onChange={(event) => {
          if (audio.current)
            audio.current.currentTime = Number(event.target.value);
          setTime(Number(event.target.value));
        }}
      />
      <span className="audio-time">{format(duration)}</span>
      <button
        type="button"
        className="media-icon-button"
        aria-label={muted ? "Включить звук" : "Выключить звук"}
        onClick={() => {
          if (audio.current) audio.current.muted = !muted;
          setMuted(!muted);
        }}
      >
        {muted ? <VolumeX size={17} /> : <Volume2 size={17} />}
      </button>
    </span>
  );
}

export function LoadedMedia({
  mime,
  data,
  target,
}: {
  mime: string;
  data: string;
  target: string;
}) {
  const [url, setUrl] = useState("");
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (mime === "application/pdf") return;
    const bytes = Uint8Array.from(atob(data), (char) => char.charCodeAt(0));
    const value = URL.createObjectURL(new Blob([bytes], { type: mime }));
    setUrl(value);
    setFailed(false);
    return () => URL.revokeObjectURL(value);
  }, [mime, data]);
  if (mime === "application/pdf")
    return (
      <Suspense fallback={<span>Подготовка PDF…</span>}>
        <PdfView data={data} target={target} />
      </Suspense>
    );
  if (failed)
    return (
      <span role="alert">
        Этот кодек не поддерживается системой. Откройте файл во внешнем
        приложении.
      </span>
    );
  return mime.startsWith("audio/") ? (
    <AudioPlayer url={url} target={target} onError={() => setFailed(true)} />
  ) : (
    <video
      controls
      preload="metadata"
      src={url || undefined}
      onError={() => {
        if (url) setFailed(true);
      }}
      aria-label={`Видео: ${target}`}
    />
  );
}

export function LocalMedia({
  target,
  wiki,
  context,
}: {
  target: string;
  wiki: boolean;
  context: RenderContext;
}) {
  const [requested, request] = useState(false);
  const [attempt, retry] = useState(0);
  const [result, setResult] = useState<{ mime: string; data: string } | null>(
    null,
  );
  const [error, setError] = useState("");
  const container = useRef<HTMLSpanElement>(null);
  const pdf = /\.pdf(?:#|$)/i.test(target);
  const video = /\.(mp4|webm|mov|mkv|ogv|3gp)(?:#|$)/i.test(target);
  const Icon = pdf ? FileText : video ? FileVideo : FileAudio;
  const label = pdf ? "PDF-документ" : video ? "Видео" : "Аудиозапись";
  const name = target.split("#")[0].split("/").pop() || target;
  useEffect(() => {
    if (pdf || !container.current) return;
    if (typeof IntersectionObserver === "undefined") {
      request(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          request(true);
          observer.disconnect();
        }
      },
      { rootMargin: "200px" },
    );
    observer.observe(container.current);
    return () => observer.disconnect();
  }, [pdf, target]);
  useEffect(() => {
    let disposed = false;
    setResult(null);
    setError("");
    if (requested)
      void api
        .readMedia(context.vaultId, context.path, target, wiki)
        .then((value) => {
          if (!disposed) setResult(value);
        })
        .catch((reason) => {
          if (!disposed) setError(errorMessage(reason));
        });
    return () => {
      disposed = true;
    };
  }, [requested, attempt, context.vaultId, context.path, target, wiki]);
  return (
    <span
      ref={container}
      className={`local-media ${video ? "media-video" : pdf ? "media-pdf" : "media-audio"}`}
    >
      <span className="media-header">
        <span className="media-icon">
          <Icon size={19} aria-hidden="true" />
        </span>
        <span className="media-title">
          <strong>{name}</strong>
          <span>{label}</span>
        </span>
        <button
          type="button"
          className="media-icon-button"
          aria-label="Показать файл"
          title="Показать файл"
          onClick={() => {
            void api
              .resolveAttachment(context.vaultId, context.path, target, wiki)
              .then((path) => api.reveal(context.vaultId, path))
              .catch((reason) => context.onError(errorMessage(reason)));
          }}
        >
          <FolderOpen size={17} aria-hidden="true" />
        </button>
        {requested && (
          <button
            type="button"
            className="media-icon-button"
            aria-label="Скрыть просмотр"
            title="Скрыть просмотр"
            onClick={() => request(false)}
          >
            <X size={17} aria-hidden="true" />
          </button>
        )}
      </span>
      {!requested ? (
        <button
          className="media-load"
          type="button"
          onClick={() => request(true)}
        >
          <Play size={15} aria-hidden="true" />
          {pdf ? "Показать PDF" : "Загрузить проигрыватель"}
        </button>
      ) : error ? (
        <span role="alert">
          {error}
          <button type="button" onClick={() => retry((value) => value + 1)}>
            Повторить
          </button>
        </span>
      ) : result ? (
        <LoadedMedia {...result} target={target} />
      ) : (
        <span role="status">Загрузка вложения…</span>
      )}
    </span>
  );
}
