import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { renderNode, safeExternal } from "../src/reading/ReadingView";
import type { RenderNode } from "../src/services/api";
afterEach(cleanup);
const context = {
  vaultId: "v",
  path: "Note.md",
  onWiki: vi.fn(),
  onError: vi.fn(),
};
const node = (kind: string, text = "", target = ""): RenderNode => ({
  from: 0,
  to: 0,
  kind,
  text,
  target,
  level: 0,
  line: 1,
  endLine: 1,
  children: [],
});
it("renders raw note HTML as inert text and blocks active URL schemes", () => {
  const raw = node(
    "literalHtml",
    "<img src=x onerror=alert(1)><script>evil()</script>",
  );
  const link = {
    ...node("link", "", "javascript:alert(1)"),
    children: [node("text", "Unsafe")],
  };
  const { container } = render(
    <>
      {renderNode(raw, context)}
      {renderNode(link, context)}
    </>,
  );
  expect(container.querySelector("script,img,a,iframe")).toBeNull();
  expect(container.textContent).toContain("onerror=alert(1)");
  for (const url of [
    "javascript:x",
    "file:///C:/x",
    "data:text/html,x",
    "//remote/image",
  ])
    expect(safeExternal(url)).toBe(false);
  expect(safeExternal("https://example.com/a")).toBe(true);
});
it("wiki reading links preserve the target anchor and displayed alias", () => {
  const link = {
    ...node("wiki", "", "Folder/Note#^block"),
    children: [node("text", "Readable alias")],
  };
  render(<>{renderNode(link, context)}</>);
  fireEvent.click(screen.getByRole("link", { name: "Readable alias" }));
  expect(context.onWiki).toHaveBeenCalledWith("Folder/Note#^block");
});
