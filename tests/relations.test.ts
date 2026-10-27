import { expect, it } from "vitest";
import type { Inspection } from "../src/services/api";
import { groupRelations } from "../src/services/relations";

it("groups repeated destinations across aliases and path spellings while keeping anchors and ambiguities separate", () => {
  const link = (
    target: string,
    path: string | null,
    anchor: string | null = null,
    alias: string | null = null,
  ): Inspection["outgoing"][number] => ({
    target,
    anchor,
    alias,
    embedded: false,
    line: 1,
    resolution: {
      status: path ? "resolved" : "missing",
      path,
      candidates: [],
      createPath: path ? null : target + ".md",
    },
  });
  const ambiguous = {
    ...link("Note", null),
    resolution: {
      status: "ambiguous",
      path: null,
      candidates: ["A/Note.md", "B/Note.md"],
      createPath: null,
    },
  };
  const data = {
    metadata: {
      title: "",
      tags: [],
      properties: {},
      warning: null,
      headings: [],
    },
    backlinks: [
      { path: "Source.md", title: "Source", line: 4, mentions: 2 },
      { path: "Source.md", title: "Source", line: 2 },
    ],
    outgoing: [
      link("Note", "A/Note.md"),
      link("./A/Note.md", "A/Note.md", null, "Первое имя"),
      link("A/Note", "A/Note.md", null, "Второе имя"),
      link("Note", "A/Note.md", "Heading"),
      link("Note", "A/Note.md", "^block"),
      link("Missing", null),
      link("Missing", null, null, "Псевдоним"),
      ambiguous,
      link("photo.png", "photo.png"),
    ],
  } as Inspection;
  const grouped = groupRelations(data);
  expect(grouped.incoming).toEqual([
    { path: "Source.md", title: "Source", line: 2, mentions: 3 },
  ]);
  expect(grouped.outgoing).toHaveLength(5);
  expect(grouped.outgoing[0]).toMatchObject({
    mentions: 3,
    alias: "Первое имя",
    aliases: ["Первое имя", "Второе имя"],
  });
  expect(grouped.outgoing[1].anchor).toBe("Heading");
  expect(grouped.outgoing[2].anchor).toBe("^block");
  expect(grouped.outgoing[3].mentions).toBe(2);
  expect(grouped.outgoing[4].resolution.status).toBe("ambiguous");
});
