import {
  Fragment,
  lazy,
  memo,
  Suspense,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  api,
  errorMessage,
  type RenderNode,
  type RenderDocument,
  type AnchorLocation,
} from "../services/api";
const MathView = lazy(() =>
  import("./RichBlocks").then((m) => ({ default: m.MathView })),
);
const Diagram = lazy(() =>
  import("./RichBlocks").then((m) => ({ default: m.Diagram })),
);
interface Context {
  theme?: string;
  vaultId: string;
  path: string;
  onWiki: (target: string) => void;
  onError: (message: string) => void;
}
function text(node: RenderNode): string {
  return node.text || node.children.map(text).join("");
}
export function safeExternal(value: string): boolean {
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol);
  } catch {
    return false;
  }
}

function LocalImage({
  target,
  alt,
  wiki,
  context,
}: {
  target: string;
  alt: string;
  wiki: boolean;
  context: Context;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const [visible, setVisible] = useState(false);
  const [src, setSrc] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    if (!ref.current) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: "300px" },
    );
    observer.observe(ref.current);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    setSrc("");
    setError("");
    void api
      .readImage(context.vaultId, context.path, target, wiki)
      .then((value) => {
        if (!cancelled) setSrc(value);
      })
      .catch((e) => {
        if (!cancelled) setError(errorMessage(e));
      });
    return () => {
      cancelled = true;
    };
  }, [visible, context.vaultId, context.path, target, wiki]);
  return (
    <span ref={ref} className="reading-image">
      {src ? (
        <img src={src} alt={alt || target} loading="lazy" />
      ) : (
        <span className="image-placeholder">
          {error || `Изображение: ${alt || target}`}
        </span>
      )}
    </span>
  );
}
function Nodes({
  nodes,
  context,
  head = false,
}: {
  nodes: RenderNode[];
  context: Context;
  head?: boolean;
}) {
  return nodes.map((node, index) => (
    <Fragment key={index}>{renderNode(node, context, head)}</Fragment>
  ));
}
export function renderNode(
  node: RenderNode,
  context: Context,
  head = false,
): ReactNode {
  const children = (
    <Nodes nodes={node.children} context={context} head={head} />
  );
  const source = {
    "data-source-line": node.line,
    "data-source-end": node.endLine,
  };
  const open = (target: string, wiki: boolean) => {
    if (wiki) {
      context.onWiki(target);
      return;
    }
    if (safeExternal(target)) {
      void api
        .openExternal(target)
        .catch((e) => context.onError(errorMessage(e)));
      return;
    }
    void api
      .documentLink(context.vaultId, context.path, target)
      .then(context.onWiki)
      .catch((e) => context.onError(errorMessage(e)));
  };
  switch (node.kind) {
    case "text":
      return node.text;
    case "paragraph":
      return <p {...source}>{children}</p>;
    case "heading": {
      const H = (["h1", "h2", "h3", "h4", "h5", "h6"] as const)[
        Math.max(0, Math.min(5, node.level - 1))
      ];
      return <H {...source}>{children}</H>;
    }
    case "emphasis":
      return <em>{children}</em>;
    case "strong":
      return <strong>{children}</strong>;
    case "strike":
      return <del>{children}</del>;
    case "quote":
      return <blockquote {...source}>{children}</blockquote>;
    case "list":
      return <ul {...source}>{children}</ul>;
    case "orderedList":
      return (
        <ol start={node.level} {...source}>
          {children}
        </ol>
      );
    case "item":
      return <li {...source}>{children}</li>;
    case "code":
      return <code>{node.text}</code>;
    case "codeBlock":
      return node.target === "mermaid" ? (
        <div {...source}>
          <Suspense fallback={<pre>{text(node)}</pre>}>
            <Diagram code={text(node)} dark={context.theme !== "light"} />
          </Suspense>
        </div>
      ) : (
        <div className="reading-code" {...source}>
          {node.target && <small>{node.target}</small>}
          <pre>
            <code>{text(node)}</code>
          </pre>
        </div>
      );
    case "math":
      return (
        <Suspense fallback={<code>{node.text}</code>}>
          <MathView value={node.text} display={!!node.level} />
        </Suspense>
      );
    case "link":
    case "wiki": {
      const blocked =
        node.kind === "link" &&
        /^[a-z][a-z0-9+.-]*:/i.test(node.target) &&
        !safeExternal(node.target);
      return blocked ? (
        <span className="blocked-link" title="Недопустимый протокол ссылки">
          {children}
        </span>
      ) : (
        <a
          href="#"
          title={node.target}
          onClick={(e) => {
            e.preventDefault();
            open(node.target, node.kind === "wiki");
          }}
        >
          {children}
        </a>
      );
    }
    case "image":
    case "embed": {
      if (
        node.kind === "embed" &&
        !/\.(png|jpe?g|gif|webp|svg)(?:#|$)/i.test(node.target)
      )
        return (
          <button
            className="note-embed"
            onClick={() => context.onWiki(node.target)}
          >
            ↗ {text(node) || node.target}
          </button>
        );
      return (
        <LocalImage
          target={node.target}
          alt={node.children.map(text).join("")}
          wiki={node.kind === "embed"}
          context={context}
        />
      );
    }
    case "table":
      return (
        <div className="reading-table" {...source}>
          <table>
            {node.children.map((row, i) =>
              row.kind === "tableHead" ? (
                <thead key={i}>
                  <tr>
                    <Nodes nodes={row.children} context={context} head />
                  </tr>
                </thead>
              ) : (
                <tbody key={i}>{renderNode(row, context)}</tbody>
              ),
            )}
          </table>
        </div>
      );
    case "tableRow":
      return <tr>{children}</tr>;
    case "tableCell":
      return head ? <th>{children}</th> : <td>{children}</td>;
    case "task":
      return (
        <input
          type="checkbox"
          checked={!!node.level}
          readOnly
          disabled
          tabIndex={-1}
          aria-label={node.level ? "Выполнено" : "Не выполнено"}
        />
      );
    case "rule":
      return <hr {...source} />;
    case "break":
      return <br />;
    case "literalHtml":
      return <code className="literal-html">{node.text}</code>;
    case "footnote":
      return (
        <aside className="reading-footnote" {...source}>
          <sup>{node.target}</sup>
          {children}
        </aside>
      );
    case "footnoteRef":
      return <sup>{node.target}</sup>;
    default:
      return children;
  }
}

export const ReadingView = memo(function ReadingView({
  vaultId,
  path,
  content,
  navigation,
  onWiki,
  onError,
  theme = "dark",
}: {
  vaultId: string;
  path: string;
  content: string;
  navigation?: (AnchorLocation & { id: number }) | null;
  onWiki: (target: string) => void;
  onError: (message: string) => void;
  theme?: string;
}) {
  const [document, setDocument] = useState<RenderDocument | null>(null);
  const [error, setError] = useState("");
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let disposed = false;
    setDocument(null);
    setError("");
    const timer = window.setTimeout(() => {
      void api
        .renderMarkdown(vaultId, path, content)
        .then((value) => {
          if (!disposed) setDocument(value);
        })
        .catch((e) => {
          if (!disposed) setError(errorMessage(e));
        });
    }, 80);
    return () => {
      disposed = true;
      window.clearTimeout(timer);
    };
  }, [vaultId, path, content]);
  useEffect(() => {
    if (!document || !navigation) return;
    const elements = Array.from(
      host.current?.querySelectorAll<HTMLElement>("[data-source-line]") ?? [],
    );
    const target =
      elements.find(
        (el) => Number(el.dataset.sourceLine) === navigation.line,
      ) ??
      elements.find(
        (el) =>
          Number(el.dataset.sourceLine) <= navigation.line &&
          Number(el.dataset.sourceEnd) >= navigation.line,
      );
    target?.scrollIntoView({ block: "center" });
    target?.classList.add("reading-anchor");
    const timer = window.setTimeout(
      () => target?.classList.remove("reading-anchor"),
      1400,
    );
    return () => window.clearTimeout(timer);
  }, [navigation?.id, document]);
  return (
    <div
      className="reading-scroll"
      ref={host}
      role="region"
      aria-label="Просмотр заметки"
      tabIndex={0}
    >
      <article className="reading-document">
        {error ? (
          <p role="alert" className="tree-error">
            {error}
          </p>
        ) : document ? (
          <>
            {document.warning && (
              <p className="tree-error">{document.warning}</p>
            )}
            {document.nodes.length ? (
              <Nodes
                nodes={document.nodes}
                context={{ vaultId, path, onWiki, onError, theme }}
              />
            ) : (
              <p className="reading-empty">В этой заметке пока нет текста.</p>
            )}
          </>
        ) : (
          <p className="reading-empty">Подготовка заметки…</p>
        )}
      </article>
    </div>
  );
});
