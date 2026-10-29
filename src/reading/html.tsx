import { createElement, Fragment, type ReactNode } from "react";
import { api, errorMessage, type RenderNode } from "../services/api";
import { renderNode, safeExternal, type RenderContext } from "./ReadingView";
import { ExternalMedia, ExternalPage } from "./ExternalMedia";

const allowed = new Set(
  "a abbr b blockquote br caption code dd del details div dl dt em h1 h2 h3 h4 h5 h6 hr i kbd li mark ol p pre s samp small span strong sub summary sup table tbody td th thead tr u ul img".split(
    " ",
  ),
);
const blocked = new Set(
  "script style iframe frame frameset object embed svg math template form input button textarea select option link meta base title audio video source track canvas".split(
    " ",
  ),
);
const local = (target: string) =>
  !!target &&
  !/^[a-z][a-z\d+.-]*:|^[\\/]{2}|[\u0000-\u001f\u007f]/i.test(target);

// Parse only in an inert template. Never mount source DOM or copy arbitrary
// attributes: React reconstructs a small passive HTML vocabulary from scratch.
export function renderHtmlNodes(
  nodes: RenderNode[],
  context: RenderContext,
  head = false,
): ReactNode {
  const token = `aether-${crypto.randomUUID()}`;
  const markup = nodes
    .map((node, index) =>
      node.kind === "literalHtml"
        ? node.text
        : `<span data-${token}="${index}"></span>`,
    )
    .join("");
  if (markup.length > 262_144)
    return <span>HTML-фрагмент слишком велик. Откройте исходник.</span>;
  const template = document.createElement("template");
  template.innerHTML = markup;
  let count = 0;
  const visit = (node: Node, depth = 0): ReactNode => {
    if (++count > 4000 || depth > 64) return null;
    if (node.nodeType === Node.TEXT_NODE) return node.textContent;
    if (!(node instanceof Element)) return null;
    const slot = node.getAttribute(`data-${token}`);
    if (slot !== null) {
      const item = nodes[Number(slot)];
      return item ? renderNode(item, context, head) : null;
    }
    const tag = node.localName.toLowerCase();
    if (
      node.namespaceURI === "http://www.w3.org/1999/xhtml" &&
      tag === "iframe"
    ) {
      const target = (node.getAttribute("src") ?? "").trim();
      return safeExternal(target) ? (
        <ExternalPage target={target} context={context} />
      ) : null;
    }
    if (
      node.namespaceURI === "http://www.w3.org/1999/xhtml" &&
      (tag === "audio" || tag === "video")
    ) {
      const target = (
        node.getAttribute("src") ??
        node.querySelector("source")?.getAttribute("src") ??
        ""
      ).trim();
      return safeExternal(target) ? (
        <ExternalMedia target={target} alt="" kind={tag} context={context} />
      ) : null;
    }
    if (
      node.namespaceURI !== "http://www.w3.org/1999/xhtml" ||
      blocked.has(tag)
    )
      return null;
    const children = [...node.childNodes].map((child, index) => (
      <Fragment key={index}>{visit(child, depth + 1)}</Fragment>
    ));
    if (!allowed.has(tag)) return children;
    if (tag === "a") {
      const target = (node.getAttribute("href") ?? "").trim();
      if (!safeExternal(target) && !local(target)) return children;
      return (
        <a
          href="#"
          title={node.getAttribute("title") ?? undefined}
          onClick={(event) => {
            event.preventDefault();
            void (
              safeExternal(target)
                ? api.openExternal(target)
                : api
                    .documentLink(context.vaultId, context.path, target)
                    .then(context.onWiki)
            ).catch((reason) => context.onError(errorMessage(reason)));
          }}
          onAuxClick={(event) => event.preventDefault()}
        >
          {children}
        </a>
      );
    }
    if (tag === "img") {
      const target = (node.getAttribute("src") ?? "").trim();
      if (safeExternal(target))
        return (
          <ExternalMedia
            target={target}
            alt={node.getAttribute("alt") ?? ""}
            kind="image"
            context={context}
          />
        );
      if (!local(target))
        return <span>{node.getAttribute("alt") || "Внешнее изображение"}</span>;
      return renderNode(
        {
          kind: "image",
          target,
          text: "",
          hasAlias: false,
          from: 0,
          to: 0,
          line: 0,
          endLine: 0,
          level: 0,
          children: [
            {
              kind: "text",
              text: node.getAttribute("alt") ?? "",
              target: "",
              hasAlias: false,
              from: 0,
              to: 0,
              line: 0,
              endLine: 0,
              level: 0,
              children: [],
            },
          ],
        },
        context,
      );
    }
    const props: Record<string, unknown> = {};
    const title = node.getAttribute("title");
    if (title) props.title = title;
    if (tag === "details") props.open = node.hasAttribute("open");
    if (tag === "td" || tag === "th") {
      for (const [attribute, property] of [
        ["colspan", "colSpan"],
        ["rowspan", "rowSpan"],
      ]) {
        const value = Number(node.getAttribute(attribute));
        if (Number.isInteger(value) && value > 0 && value <= 100)
          props[property] = value;
      }
    }
    return createElement(
      tag,
      props,
      ...(tag === "br" || tag === "hr" ? [] : children),
    );
  };
  return [...template.content.childNodes].map((node, index) => (
    <Fragment key={index}>{visit(node)}</Fragment>
  ));
}
