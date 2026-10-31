import { configure } from "@testing-library/react";

// Async previews and layout warmup must also complete on shared CI runners.
configure({ asyncUtilTimeout: 5000 });

// jsdom has no layout engine. CodeMirror still measures text during updates.
Object.defineProperties(Range.prototype, {
  getClientRects: { configurable: true, value: () => [] },
  getBoundingClientRect: { configurable: true, value: () => new DOMRect() },
});
