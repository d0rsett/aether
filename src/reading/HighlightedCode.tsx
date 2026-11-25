import { memo, type ReactNode } from "react";
import { highlightTree } from "@lezer/highlight";
import { codeHighlight, codeLanguage } from "../markdown/codeSyntax";

export const HighlightedCode = memo(function HighlightedCode({
  source,
  language,
}: {
  source: string;
  language: string;
}) {
  const parser = codeLanguage(language)?.parser;
  if (!parser) return <code>{source}</code>;

  const parts: ReactNode[] = [];
  let position = 0;
  highlightTree(parser.parse(source), codeHighlight, (from, to, classes) => {
    if (from > position) parts.push(source.slice(position, from));
    parts.push(
      <span className={classes} key={from}>
        {source.slice(from, to)}
      </span>,
    );
    position = to;
  });
  if (position < source.length) parts.push(source.slice(position));
  return <code>{parts}</code>;
});
