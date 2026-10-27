import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { renderNode, safeExternal } from "../src/reading/ReadingView";
import type { RenderNode } from "../src/services/api";
afterEach(cleanup);
it("renders highlights and collapsed callouts without exposing comment text", () => {
  const title = { ...node("calloutTitle", "Предупреждение") };
  const callout = {
    ...node("callout", "", "warning"),
    level: 2,
    children: [
      title,
      { ...node("paragraph"), children: [node("text", "Содержимое")] },
    ],
  };
  const { container } = render(
    <>
      {renderNode(callout, context)}
      {renderNode(
        { ...node("highlight"), children: [node("text", "Важно")] },
        context,
      )}
      {renderNode(node("comment", "Секрет"), context)}
    </>,
  );
  expect(container.querySelector("details")?.open).toBe(false);
  expect(container.querySelector("summary")?.textContent).toBe(
    "Предупреждение",
  );
  expect(container.querySelector("mark")?.textContent).toBe("Важно");
  expect(container.textContent).not.toContain("Секрет");
});
it("forwards task clicks with their precise source marker", () => {
  const task = { ...node("task", "[ ]"), from: 5, to: 8 };
  const onTask = vi.fn();
  render(<>{renderNode(task, { ...context, onTask })}</>);
  fireEvent.click(screen.getByRole("checkbox"));
  expect(onTask).toHaveBeenCalledWith(task);
});
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

it("uses image descriptions as captions, excludes dimensions and keeps plain embeds uncaptioned", () => {
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  try {
    for (const [kind, label, hasAlias, expected] of [
      ["embed", "Фото озера|300x200", true, "Фото озера"],
      ["image", "Markdown caption", false, "Markdown caption"],
      ["embed", "300", true, ""],
      ["embed", "photo.png", false, ""],
      ["embed", "photo.png", true, "photo.png"],
    ] as const) {
      const { container, unmount } = render(
        <>
          {renderNode(
            {
              ...node(kind, "", "photo.png"),
              hasAlias,
              children: [node("text", label)],
            },
            context,
          )}
        </>,
      );
      expect(container.querySelector(".image-caption")?.textContent || "").toBe(
        expected,
      );
      unmount();
    }
  } finally {
    vi.unstubAllGlobals();
  }
});
