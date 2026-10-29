import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { renderHtmlNodes } from "../src/reading/html";
import { renderNode, type RenderContext } from "../src/reading/ReadingView";
import { api, type RenderNode } from "../src/services/api";
const context: RenderContext = {
  vaultId: "v",
  path: "Note.md",
  onWiki: vi.fn(),
  onError: vi.fn(),
};
const node = (kind: string, text = "", target = ""): RenderNode => ({
  kind,
  text,
  target,
  from: 0,
  to: 1,
  line: 1,
  endLine: 1,
  level: 0,
  children: [],
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
HTMLElement.prototype.scrollIntoView = vi.fn();
it("renders passive HTML and mixed Markdown while discarding active content and attributes", () => {
  const { container } = render(
    <>
      {renderHtmlNodes(
        [
          node(
            "literalHtml",
            '<details open onclick="evil()"><summary>More</summary><b style="position:fixed" id="spoof">',
          ),
          node("text", "Markdown text"),
          node(
            "literalHtml",
            '</b><br><table><tr><td colspan="2">Cell</td></tr></table></details><script>evil()</script><iframe src="https://example.com"></iframe><svg onload="evil()"><text>Bad</text></svg><img src="https://example.com/image" onerror="evil()"><a href="java&#115;cript:evil()">Unsafe</a>',
          ),
        ],
        context,
      )}
    </>,
  );
  expect(container.querySelector("details")?.open).toBe(true);
  expect(container.querySelector("b")?.textContent).toBe("Markdown text");
  expect(container.querySelector("td")?.colSpan).toBe(2);
  expect(
    container.querySelector(
      "script,iframe,svg:not(.lucide),img,[onclick],[style],[id],a",
    ),
  ).toBeNull();
  expect(container.textContent).not.toContain("evil()");
});
it("opens safe HTML links through the existing explicit external action", async () => {
  const open = vi.spyOn(api, "openExternal").mockResolvedValue(undefined);
  render(
    <>
      {renderHtmlNodes(
        [node("literalHtml", '<a href="https://example.com/">Website</a>')],
        context,
      )}
    </>,
  );
  expect(open).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("link", { name: "Website" }));
  expect(open).toHaveBeenCalledWith("https://example.com/");
});
it("returns to the clicked repeated reference and keeps embedded footnotes scoped", () => {
  const reference = node("footnoteRef", "", "1"),
    footnote = node("footnote", "", "1");
  const { container } = render(
    <article className="reading-document">
      {renderNode(reference, context)}
      {renderNode(reference, context)}
      {renderNode(footnote, context)}
      <div className="note-transclusion-body">
        {renderNode(reference, context)}
        {renderNode(footnote, context)}
      </div>
    </article>,
  );
  const refs = screen.getAllByRole("button", { name: "Перейти к сноске 1" });
  fireEvent.click(refs[1]);
  expect(document.activeElement).toBe(container.querySelector("aside"));
  fireEvent.click(
    screen.getAllByRole("button", { name: "Вернуться из сноски 1" })[0],
  );
  expect(document.activeElement).toBe(refs[1]);
  fireEvent.click(refs[2]);
  expect(document.activeElement).toBe(
    container.querySelector(".note-transclusion-body aside"),
  );
});
