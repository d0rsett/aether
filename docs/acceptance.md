# Acceptance baseline and history

[Русский](acceptance.ru.md) · [Documentation](README.md) · [Project](../README.md)

**Historical checklist, maintained as a reference.** This is not a release certification or a record of checks automatically run on every change. For current commands and actual test reports see [native testing](native-testing.md) and CI.

## End-to-end writing journey

1. Open an isolated synthetic vault and create a note/folder without overwriting existing files.
2. Edit in Source and Live Preview; verify selection, caret, wrapping, scroll and undo after mode/theme/language changes.
3. Add properties, a table, links, an attachment and a template; verify the source remains portable Markdown.
4. Save explicitly and compare disk bytes, including supported BOM and newline preservation.
5. Introduce an external revision, verify conflict handling and preserve both versions.
6. Rename/move a linked note or folder, review updated targets and test Undo/conflict recovery.
7. Close with unsaved edits, restart and recover the draft without an implicit original-file save.
8. Check both languages/themes, narrow layouts, menus, accessible labels and keyboard focus.

## Earlier milestones

The initial MVP established local vault operations, conflict-aware saves, drafts and custom window controls. Stage 2 added indexing, links, navigation and recoverable rename transactions. Stage 3 introduced shared Reading/Live Preview rendering, attachments, math and diagrams. Later work added inline tables/properties, PDF/media, passive HTML, templates, folding and linked-buffer previews.

Frontend unit tests, Rust temporary-filesystem tests, production builds and isolated Windows-native scenarios validate different layers. Passing a build alone does not establish visual correctness. Native automation does not validate physical window dragging or performance budgets. Never use a personal vault for this checklist.
