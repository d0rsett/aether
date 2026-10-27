import { render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { NoteRelations } from "../src/components/NoteRelations";
import { collectAttachments } from "../src/services/attachments";
import type { Inspection, RenderNode } from "../src/services/api";

function reference(
  kind: string,
  target: string,
  label = "",
  hasAlias = false,
): RenderNode {
  return {
    kind,
    target,
    hasAlias,
    children: label ? [{ ...reference("text", ""), text: label }] : [],
    from: 0,
    to: 1,
    line: 1,
    endLine: 1,
    text: "",
    level: 0,
  };
}
it("collects local attachments with aliases, strips sizes and ignores prose links and code", () => {
  const code = reference("codeBlock", "");
  code.children = [reference("embed", "Hidden.png")];
  expect(
    collectAttachments([
      reference("embed", "Photo.png", "Photo.png"),
      reference("embed", "Photo.png", "Моя подпись|300", true),
      reference("embed", "Photo.png", "Другая подпись", true),
      reference("image", "Folder/Other.png", "200x100"),
      reference("image", "https://example.com/photo.png", "Remote"),
      reference("wiki", "Note", "Note"),
      reference("embed", "Report.pdf"),
      code,
    ]).map((item) => [item.target, item.label]),
  ).toEqual([
    ["Photo.png", "Моя подпись"],
    ["Folder/Other.png", ""],
    ["Report.pdf", ""],
  ]);
});
it("excludes attachment targets from outgoing note links even when they have aliases", () => {
  const link = (target: string, alias: string | null) => ({
    target,
    alias,
    embedded: true,
    anchor: null,
    line: 1,
    resolution: {
      status: "missing",
      path: null,
      candidates: [],
      createPath: target + ".md",
    },
  });
  const data = {
    metadata: {
      warning: null,
      tags: [],
      properties: {},
      title: "",
      headings: [],
    },
    backlinks: [],
    outgoing: [
      link("Photo.png", null),
      link("Photo.png", "Другое имя"),
      link("Report.pdf", "Отчёт"),
      link("Other", null),
    ],
  } as Inspection;
  render(<NoteRelations data={data} onOpen={vi.fn()} onWiki={vi.fn()} />);
  expect(screen.queryByText("Photo.png")).toBeNull();
  expect(screen.queryByText("Другое имя")).toBeNull();
  expect(screen.queryByText("Отчёт")).toBeNull();
  expect(screen.getByRole("button", { name: "Other" })).toBeTruthy();
});
