import { useState } from "react";

interface History {
  current: string;
  past: string[];
  future: string[];
  edit: string | undefined;
}

const MAX_ENTRIES = 64;
const MAX_CHARACTERS = 8 * 1024 * 1024;

function append(stack: string[], value: string): string[] {
  const next = [...stack.slice(1 - MAX_ENTRIES), value];
  let length = 0;
  for (let index = next.length - 1; index >= 0; index--) {
    length += next[index].length;
    if (length > MAX_CHARACTERS) return next.slice(index + 1);
  }
  return next;
}

export function useCanvasHistory(
  content: string,
  onChange: (content: string) => void,
) {
  const [saved, setSaved] = useState<History | null>(null);
  // A reload or recovered draft is a new document baseline.
  const history: History =
    saved?.current === content
      ? saved
      : { current: content, past: [], future: [], edit: undefined };

  const apply = (next: History) => {
    setSaved(next);
    onChange(next.current);
  };

  return {
    canUndo: history.past.length > 0,
    canRedo: history.future.length > 0,
    commit(next: string, edit?: string) {
      if (next === content) return;
      apply({
        current: next,
        past:
          edit !== undefined && history.edit === edit
            ? history.past
            : append(history.past, content),
        future: [],
        edit,
      });
    },
    finishEdit() {
      if (history.edit !== undefined) setSaved({ ...history, edit: undefined });
    },
    step(redo: boolean) {
      const stack = redo ? history.future : history.past;
      const next = stack.at(-1);
      if (next === undefined) return false;
      apply({
        current: next,
        past: redo ? append(history.past, content) : stack.slice(0, -1),
        future: redo ? stack.slice(0, -1) : append(history.future, content),
        edit: undefined,
      });
      return true;
    },
  };
}
