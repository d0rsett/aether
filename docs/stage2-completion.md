# Stage 2: transaction and navigation record

[Русский](stage2-completion.ru.md) · [Documentation](README.md) · [Project](../README.md)

**Historical engineering milestone.** Current behavior is described in [architecture](architecture.md) and the [API guide](knowledge-api.md).

## Rename and recovery

The server builds rename plans from real Markdown files, independent of the search cache. Preview returns a token, counts, affected tabs and paginated reference changes. Apply accepts the token, never client-authored replacement text. Plans are transient; restart requires a new preview.

Before applying, vault inventory and revisions are checked again. Supported references preserve display labels, anchors, code examples, BOM and line endings; moving a note also accounts for its relative outgoing links. Dirty affected tabs block application.

Before/after snapshots and a journal are stored under `.aether/renames/<id>/`, with a pointer at `.aether/rename.json`. Rollback/Undo validate current contents before writing; conflicts keep recovery information. An interrupted operation is detected at startup but recovery requires an explicit user action. Directory transactions additionally retain descendant inventory and remap paths.

## Navigation and validation

Heading/block navigation uses parser ranges and can locate targets in the current dirty buffer without discarding undo. Frontend ignores stale requests. Tests cover link updates, preview cancellation, conflicts, Undo and restart with an interrupted journal. This record describes contracts, not a new claim that every historical test was rerun for a documentation change.
