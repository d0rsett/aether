import { StreamLanguage, type StringStream } from "@codemirror/language";
import { tags } from "@lezer/highlight";

interface PythonState {
  quote: string | null;
  declaration: "functionName" | "typeName" | null;
}

const keywords = new Set(
  "and as assert async await break class continue def del elif else except finally for from global if import in is lambda nonlocal not or pass raise return try while with yield".split(
    " ",
  ),
);
const stringStart = /^(?:(?:fr|rf|br|rb|f|r|u|b))?("""|'''|"|')/i;
const identifier = /^[_\p{ID_Start}][_\p{ID_Continue}]*/u;
const number =
  /^(?:0[xX](?:_?[0-9a-fA-F])+|0[oO](?:_?[0-7])+|0[bB](?:_?[01])+|(?:\d(?:_?\d)*(?:\.(?:\d(?:_?\d)*)?)?|\.\d(?:_?\d)*)(?:[eE][+-]?\d(?:_?\d)*)?[jJ]?)/;

function readString(stream: StringStream, state: PythonState, quote: string) {
  while (!stream.eol()) {
    if (stream.match(quote)) {
      state.quote = null;
      return "string";
    }
    if (stream.next() === "\\" && stream.next() === undefined) return "string";
  }
  if (quote.length === 1) state.quote = null;
  return "string";
}

export const pythonLanguage = StreamLanguage.define<PythonState>({
  name: "python",
  startState: () => ({ quote: null, declaration: null }),
  tokenTable: { functionName: tags.function(tags.variableName) },
  languageData: { commentTokens: { line: "#" } },
  token(stream, state) {
    if (state.quote) return readString(stream, state, state.quote);
    if (stream.sol()) state.declaration = null;
    if (stream.eatSpace()) return null;
    if (stream.eat("#")) {
      stream.skipToEnd();
      return "comment";
    }
    const string = stream.match(stringStart);
    if (Array.isArray(string)) {
      state.quote = string[1];
      return readString(stream, state, string[1]);
    }
    if (stream.match(number)) return "number";
    const declaration = state.declaration;
    state.declaration = null;
    if (stream.match(identifier)) {
      const word = stream.current();
      if (word === "True" || word === "False") return "bool";
      if (word === "None") return "null";
      if (word === "def") state.declaration = "functionName";
      if (word === "class") state.declaration = "typeName";
      if (keywords.has(word)) return "keyword";
      return (
        declaration ?? (stream.match(/^\s*\(/, false) ? "functionName" : null)
      );
    }
    stream.next();
    return null;
  },
});
