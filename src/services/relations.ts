import type { Inspection } from "./api";
import { attachmentExtension } from "./attachments";

export function groupRelations(data: Inspection) {
  const incoming = new Map<
    string,
    Inspection["backlinks"][number] & { mentions: number }
  >();
  for (const link of data.backlinks) {
    const previous = incoming.get(link.path);
    incoming.set(link.path, {
      ...link,
      line: Math.min(previous?.line ?? link.line, link.line),
      mentions: (previous?.mentions ?? 0) + (link.mentions ?? 1),
    });
  }
  const outgoing = new Map<
    string,
    Inspection["outgoing"][number] & { mentions: number; aliases: string[] }
  >();
  for (const link of data.outgoing) {
    if (attachmentExtension(link.target)) continue;
    const resolution = link.resolution;
    const destination =
      resolution.path ||
      resolution.createPath ||
      JSON.stringify([link.target, [...resolution.candidates].sort()]);
    const key = JSON.stringify([
      resolution.status,
      destination,
      link.anchor || "",
    ]);
    const previous = outgoing.get(key);
    const aliases = [
      ...new Set([
        ...(previous?.aliases ?? []),
        ...(link.alias ? [link.alias] : []),
      ]),
    ];
    outgoing.set(
      key,
      previous
        ? {
            ...previous,
            alias: previous.alias || link.alias,
            mentions: previous.mentions + 1,
            aliases,
          }
        : { ...link, mentions: 1, aliases },
    );
  }
  return { incoming: [...incoming.values()], outgoing: [...outgoing.values()] };
}
