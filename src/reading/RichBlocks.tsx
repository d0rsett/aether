import { t, useLocale } from "../i18n";
import { useEffect, useMemo, useState } from "react";
import katex from "katex";
import "katex/dist/katex.min.css";
export function MathView({
  value,
  display,
}: {
  value: string;
  display: boolean;
}) {
  useLocale();
  const html = useMemo(
    () =>
      katex.renderToString(value, {
        displayMode: display,
        throwOnError: false,
        trust: false,
        strict: "ignore",
        maxSize: 20,
        maxExpand: 500,
        output: "htmlAndMathml",
      }),
    [value, display],
  );
  return (
    <span
      className={display ? "reading-math display" : "reading-math"}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
let serial = 0;
export function Diagram({ code, dark }: { code: string; dark: boolean }) {
  useLocale();
  const [result, setResult] = useState<{
    svg: string;
    height: number;
  } | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let cancelled = false;
    setResult(null);
    setError("");
    void (async () => {
      if (code.length > 20000)
        throw new Error(t("Диаграмма превышает 20 000 символов."));
      const { default: mermaid } = await import("mermaid");
      mermaid.initialize({
        startOnLoad: false,
        securityLevel: "strict",
        theme: dark ? "dark" : "neutral",
        maxTextSize: 20000,
        maxEdges: 300,
        suppressErrorRendering: true,
        flowchart: { htmlLabels: false },
        secure: [
          "secure",
          "securityLevel",
          "startOnLoad",
          "maxTextSize",
          "maxEdges",
          "suppressErrorRendering",
          "flowchart",
          "themeCSS",
        ],
      });
      // Diagram-authored configuration is intentionally excluded; only diagram syntax is accepted.
      if (code.includes("%%{") || /^\s*---/.test(code))
        throw new Error(
          t("Настройки Mermaid внутри заметки не поддерживаются."),
        );
      const { svg } = await mermaid.render(`aether-diagram-${++serial}`, code);
      const parsed = new DOMParser().parseFromString(svg, "image/svg+xml");
      const viewBox = parsed.documentElement
        .getAttribute("viewBox")
        ?.split(/\s+/)
        .map(Number);
      const height =
        viewBox && viewBox[2] > 0
          ? Math.min(520, Math.max(160, (700 * viewBox[3]) / viewBox[2]))
          : 300;
      if (!cancelled) setResult({ svg, height });
    })().catch(() => {
      if (!cancelled)
        setError(
          t("Не удалось построить диаграмму. Проверьте синтаксис Mermaid."),
        );
    });
    return () => {
      cancelled = true;
    };
  }, [code, dark]);
  const srcDoc = result
    ? `<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'"><style>html,body{margin:0;background:${dark ? "#202624" : "#f5f5f1"}}svg{display:block;max-width:100%;height:auto;margin:auto}</style></head><body>${result.svg}</body></html>`
    : "";
  return (
    <figure className="reading-diagram">
      {result ? (
        <iframe
          title={t("Диаграмма Mermaid")}
          sandbox=""
          srcDoc={srcDoc}
          style={{ height: result.height }}
        />
      ) : (
        <>
          <figcaption>{error || t("Построение диаграммы\u2026")}</figcaption>
          <pre>
            <code>{code}</code>
          </pre>
        </>
      )}
    </figure>
  );
}
