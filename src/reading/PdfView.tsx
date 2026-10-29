import { useEffect, useRef, useState } from "react";
import {
  getDocument,
  GlobalWorkerOptions,
  TextLayer,
  type PDFDocumentProxy,
  type RenderTask,
} from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
GlobalWorkerOptions.workerSrc = workerUrl;

export function PdfView({ data, target }: { data: string; target: string }) {
  const options = new URLSearchParams(target.split("#")[1] ?? "");
  const initial = Math.max(1, Number(options.get("page")) || 1);
  const height = Math.max(
    180,
    Math.min(900, Number(options.get("height")) || 480),
  );
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
  const [page, setPage] = useState(initial);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(true);
  const canvas = useRef<HTMLCanvasElement>(null);
  const textSurface = useRef<HTMLSpanElement>(null);
  const pageSurface = useRef<HTMLSpanElement>(null);
  const [width, setWidth] = useState(600);
  const [size, setSize] = useState({ width: 600, height: 400 });
  const passwordCallback = useRef<((password: string) => void) | null>(null);
  const [passwordNeeded, setPasswordNeeded] = useState(false);
  const [password, setPassword] = useState("");
  const [query, setQuery] = useState("");
  const [matches, setMatches] = useState<number[]>([]);
  const [searching, setSearching] = useState(false);
  const [annotations, setAnnotations] = useState<
    { id: string; title: string; text: string }[]
  >([]);
  useEffect(() => {
    if (!pageSurface.current) return;
    const observer = new ResizeObserver((entries) => {
      const next = Math.floor(entries[0]?.contentRect.width ?? 600);
      if (next > 0) setWidth(next);
    });
    observer.observe(pageSurface.current);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (busy || !textSurface.current) return;
    const needle = query.trim().toLocaleLowerCase();
    for (const span of textSurface.current.querySelectorAll<HTMLSpanElement>(
      "span:not(.markedContent)",
    )) {
      const text = span.textContent ?? "";
      span.replaceChildren();
      let offset = 0;
      let found = needle ? text.toLocaleLowerCase().indexOf(needle) : -1;
      while (found >= 0) {
        span.append(document.createTextNode(text.slice(offset, found)));
        const mark = document.createElement("mark");
        mark.textContent = text.slice(found, found + needle.length);
        span.append(mark);
        offset = found + needle.length;
        found = text.toLocaleLowerCase().indexOf(needle, offset);
      }
      span.append(document.createTextNode(text.slice(offset)));
    }
  }, [query, busy, page]);
  useEffect(() => {
    let disposed = false;
    setPdf(null);
    setError("");
    setBusy(true);
    setAnnotations([]);
    setPasswordNeeded(false);
    setPassword("");
    setQuery("");
    const task = getDocument({
      data: Uint8Array.from(atob(data), (char) => char.charCodeAt(0)),
      enableXfa: false,
      disableFontFace: true,
      useSystemFonts: true,
      standardFontDataUrl: new URL(
        "/pdfjs/standard_fonts/",
        window.location.href,
      ).href,
      cMapUrl: new URL("/pdfjs/cmaps/", window.location.href).href,
      cMapPacked: true,
      useWasm: false,
      useWorkerFetch: false,
      maxImageSize: 16_000_000,
    });
    task.onPassword = (update: (password: string) => void, reason: number) => {
      if (disposed) return;
      passwordCallback.current = update;
      setPasswordNeeded(true);
      setBusy(false);
      if (reason === 2) setError("Неверный пароль. Попробуйте ещё раз.");
    };
    void task.promise
      .then((value) => {
        if (!disposed) {
          setPdf(value);
          setPasswordNeeded(false);
          setPassword("");
          setPage(Math.min(Math.floor(initial), value.numPages));
        }
      })
      .catch(() => {
        if (!disposed) {
          setError(
            "Не удалось открыть PDF. Файл повреждён или защищён паролем.",
          );
          setBusy(false);
        }
      });
    return () => {
      disposed = true;
      passwordCallback.current = null;
      void task.destroy();
    };
  }, [data, initial]);
  useEffect(() => {
    let active = true;
    setMatches([]);
    if (!pdf || !query.trim()) {
      setSearching(false);
      return;
    }
    setSearching(true);
    const timer = window.setTimeout(() => {
      void (async () => {
        const found: number[] = [];
        for (let index = 1; index <= pdf.numPages && active; index++) {
          const value = await pdf.getPage(index);
          const text = await value.getTextContent();
          if (
            text.items
              .map((item) => ("str" in item ? item.str : ""))
              .join(" ")
              .toLocaleLowerCase()
              .includes(query.trim().toLocaleLowerCase())
          )
            found.push(index);
        }
        if (active) {
          setMatches(found);
          setSearching(false);
          if (found.length) setPage(found[0]);
        }
      })().catch(() => {
        if (active) {
          setSearching(false);
          setError("Не удалось выполнить поиск в PDF.");
        }
      });
    }, 250);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [pdf, query]);
  useEffect(() => {
    if (!pdf || !canvas.current) return;
    let disposed = false;
    let render: RenderTask | undefined;
    let layer: TextLayer | undefined;
    const surface = canvas.current;
    setBusy(true);
    setAnnotations([]);
    textSurface.current?.replaceChildren();
    setError("");
    void pdf
      .getPage(page)
      .then(async (value) => {
        if (disposed) return;
        const original = value.getViewport({ scale: 1 });
        const viewport = value.getViewport({
          scale: Math.min(
            2,
            width / original.width,
            1400 / original.width,
            2000 / original.height,
          ),
        });
        surface.width = Math.ceil(viewport.width);
        surface.height = Math.ceil(viewport.height);
        setSize({ width: viewport.width, height: viewport.height });
        render = value.render({ canvas: surface, viewport });
        await render.promise;
        if (disposed) return;
        const text = await value.getTextContent();
        if (disposed || !textSurface.current) return;
        textSurface.current.replaceChildren();
        textSurface.current.style.setProperty(
          "--total-scale-factor",
          String(viewport.scale),
        );
        layer = new TextLayer({
          textContentSource: text,
          container: textSurface.current,
          viewport,
        });
        await layer.render();
        const notes = await value.getAnnotations({ intent: "display" });
        if (disposed) return;
        setAnnotations(
          notes
            .filter(
              (note) =>
                note.subtype !== "Widget" &&
                (note.contentsObj?.str || note.titleObj?.str),
            )
            .map((note) => ({
              id: String(note.id),
              title: String(note.titleObj?.str || note.subtype || "Примечание"),
              text: String(note.contentsObj?.str || ""),
            })),
        );
        if (!disposed) setBusy(false);
      })
      .catch(() => {
        if (!disposed) {
          setError("Не удалось показать страницу PDF.");
          setBusy(false);
        }
      });
    return () => {
      disposed = true;
      render?.cancel();
      layer?.cancel();
    };
  }, [pdf, page, width]);
  return (
    <span className="pdf-view">
      <span className="media-tools">
        <button
          type="button"
          disabled={!pdf || page <= 1 || busy}
          onClick={() => setPage(page - 1)}
        >
          Предыдущая страница
        </button>
        <span aria-live="polite">
          {pdf ? `${page} / ${pdf.numPages}` : "PDF"}
        </span>
        <button
          type="button"
          disabled={!pdf || page >= pdf.numPages || busy}
          onClick={() => setPage(page + 1)}
        >
          Следующая страница
        </button>
      </span>
      {passwordNeeded && (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            setError("");
            setBusy(true);
            passwordCallback.current?.(password);
            setPassword("");
          }}
        >
          <label>
            Пароль PDF{" "}
            <input
              type="password"
              autoComplete="off"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </label>
          <button type="submit">Открыть PDF</button>
        </form>
      )}
      {pdf && (
        <span className="media-tools">
          <input
            aria-label="Поиск в PDF"
            placeholder="Найти в PDF…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          {query && (
            <>
              <span role="status">
                {searching
                  ? "Поиск…"
                  : `Страниц с совпадениями: ${matches.length}`}
              </span>
              <button
                type="button"
                disabled={!matches.length || searching}
                onClick={() =>
                  setPage(matches.find((index) => index > page) ?? matches[0])
                }
              >
                Следующее совпадение
              </button>
            </>
          )}
        </span>
      )}
      {error && <span role="alert">{error}</span>}
      {busy && <span role="status">Подготовка страницы…</span>}
      <span
        ref={pageSurface}
        className="pdf-pages"
        style={{ maxHeight: height }}
      >
        <span className="pdf-sheet" style={size}>
          <canvas ref={canvas} aria-label={`Страница PDF ${page}`} />
          <span ref={textSurface} className="textLayer" />
        </span>
      </span>
      {!!annotations.length && (
        <details>
          <summary>Аннотации страницы ({annotations.length})</summary>
          {annotations.map((note) => (
            <span className="pdf-note" key={note.id}>
              <strong>{note.title}</strong>
              <span>{note.text}</span>
            </span>
          ))}
        </details>
      )}
    </span>
  );
}
