import { t, useLocale } from "../i18n";
import { useEffect, useLayoutEffect, useMemo, useState } from "react";
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
const diagramThemeColors = [
  "--surface",
  "--hover",
  "--border",
  "--accent",
  "--muted",
  "--text",
];

export function Diagram({ code, dark }: { code: string; dark: boolean }) {
  useLocale();
  const [result, setResult] = useState<{
    id: string;
    svg: string;
    width: number;
    height: number;
  } | null>(null);
  const [error, setError] = useState("");
  const [themeColors, setThemeColors] = useState("");
  useLayoutEffect(() => {
    const root = document.documentElement;
    const updateColors = () => {
      const styles = getComputedStyle(root);
      const colors = diagramThemeColors.map((name) => {
        const value = styles.getPropertyValue(name).trim();
        return !value.includes("<") && CSS.supports("color", value)
          ? `${name}: ${value};`
          : "";
      });
      setThemeColors(colors.join("\n"));
    };
    // Live Preview mounts its widgets in separate React roots.
    const observer = new MutationObserver(updateColors);
    observer.observe(root, {
      attributeFilter: ["data-theme", "data-palette", "style"],
    });
    updateColors();
    return () => observer.disconnect();
  }, []);
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
      const id = `aether-diagram-${++serial}`;
      const { svg } = await mermaid.render(id, code);
      const parsed = new DOMParser().parseFromString(svg, "image/svg+xml");
      const root = parsed.documentElement;
      const viewBox = root
        .getAttribute("viewBox")
        ?.trim()
        .split(/[\s,]+/)
        .map(Number);
      const width =
        viewBox?.[2] ?? parseFloat(root.getAttribute("width") ?? "");
      const height =
        viewBox?.[3] ?? parseFloat(root.getAttribute("height") ?? "");
      if (![width, height].every((n) => Number.isFinite(n) && n > 0))
        throw new Error("Invalid diagram dimensions");
      if (!viewBox) root.setAttribute("viewBox", `0 0 ${width} ${height}`);
      if (!cancelled)
        setResult({
          id,
          svg: new XMLSerializer().serializeToString(root),
          width,
          height,
        });
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
  // Chromium paints an opaque canvas when the frame and document color schemes differ.
  const colorScheme = dark ? "dark" : "light";
  const flowchart = `#${result?.id}[aria-roledescription^="flowchart"]`;
  const srcDoc = result
    ? `<!doctype html><html><head><meta name="color-scheme" content="${colorScheme}"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'">
      <style>
        html, body { height: 100%; margin: 0; background: transparent; overflow: hidden; }
        body > svg { display: block; width: 100% !important; height: 100% !important; max-width: none !important; background: transparent !important; }
        ${flowchart} {
          ${themeColors}
          --node-fill: var(--hover);
          --decision-fill: color-mix(in srgb, var(--hover) 80%, var(--accent));
          --node-border: color-mix(in srgb, var(--border) 60%, var(--muted));
          --connector: color-mix(in srgb, var(--muted) 70%, var(--text));
          --branch-fill: var(--surface);
          --label: var(--text);
        }
        ${flowchart} .node > .label-container,
        ${flowchart} .node .outer-path {
          fill: var(--node-fill);
          stroke: var(--node-border);
          filter: none;
        }
        ${flowchart} .node > rect.label-container:not([rx]),
        ${flowchart} .node > rect.label-container[rx="0"] { rx: 7px; ry: 7px; }
        ${flowchart} .node > polygon.label-container { fill: var(--decision-fill); }
        ${flowchart} .nodeLabel,
        ${flowchart} .edgeLabel text { fill: var(--label); }
        ${flowchart} .edgePaths .flowchart-link { stroke: var(--connector); }
        ${flowchart} .marker { fill: var(--connector); stroke: var(--connector); }
        ${flowchart} .edgeLabel { background: transparent; }
        ${flowchart} .edgeLabel rect { fill: var(--branch-fill); opacity: 1; rx: 3px; ry: 3px; }
      </style></head><body>${result.svg}</body></html>`
    : "";
  return (
    <figure className="reading-diagram">
      {result ? (
        <iframe
          title={t("Диаграмма Mermaid")}
          sandbox=""
          srcDoc={srcDoc}
          style={{
            colorScheme,
            maxWidth: result.width,
            aspectRatio: `${result.width} / ${result.height}`,
          }}
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
