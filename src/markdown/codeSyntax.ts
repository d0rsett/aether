import { cssLanguage } from "@codemirror/lang-css";
import { htmlLanguage } from "@codemirror/lang-html";
import {
  javascriptLanguage,
  jsxLanguage,
  tsxLanguage,
  typescriptLanguage,
} from "@codemirror/lang-javascript";
import type { Language } from "@codemirror/language";
import { tagHighlighter, tags } from "@lezer/highlight";
import { pythonLanguage } from "./pythonSyntax";

const codeLanguages = new Map<string, Language>([
  ["js", javascriptLanguage],
  ["javascript", javascriptLanguage],
  ["mjs", javascriptLanguage],
  ["cjs", javascriptLanguage],
  ["jsx", jsxLanguage],
  ["ts", typescriptLanguage],
  ["typescript", typescriptLanguage],
  ["tsx", tsxLanguage],
  ["json", javascriptLanguage.configure({ top: "SingleExpression" })],
  ["css", cssLanguage],
  ["html", htmlLanguage],
  ["htm", htmlLanguage],
  ["python", pythonLanguage],
  ["py", pythonLanguage],
  ["python3", pythonLanguage],
]);

export function codeLanguage(info: string) {
  return codeLanguages.get(info.toLowerCase()) ?? null;
}

export const codeHighlight = tagHighlighter([
  { tag: [tags.keyword, tags.tagName], class: "syntax-keyword" },
  { tag: [tags.string, tags.regexp], class: "syntax-string" },
  { tag: [tags.bool, tags.null, tags.number], class: "syntax-literal" },
  {
    tag: [
      tags.typeName,
      tags.attributeName,
      tags.propertyName,
      tags.function(tags.variableName),
      tags.function(tags.propertyName),
    ],
    class: "syntax-name",
  },
  { tag: tags.comment, class: "syntax-comment" },
]);
