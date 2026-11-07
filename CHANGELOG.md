# Changelog

[Русский](CHANGELOG.ru.md) · [README](README.md)

## 1.0.0 — 2026-11-07

- Add portable JSON Canvas boards with text, note and media cards, connections and groups.
- Edit shared note drafts on the board; convert text cards to Markdown notes and import dropped files.
- Autosave boards with revision checks and recovery drafts. Update canvas file and group background references through journaled renames.
- Add selection rectangles, snapping, clipboard operations, resizing and undo/redo.
- Unify file menus and support per-vault custom file and folder icons.
- Display default file/folder icons, adapt text selection to the palette, and use custom settings dropdowns.

## 0.4.0 — 2026-11-05

- Add a settings window with editor typography, default note mode, and startup choices for the last note, a selected note, or recent files.
- Add system appearance, theme previews, custom accent colors, palette presets, interface density, and adjustable dividers.
- Reorder note, image, and graph tabs by dragging or with the keyboard. Restore their order and use an optional overflow list.
- Open links in the current or a new tab while keeping tabs with unsaved drafts open.
- Choose an attachment folder and link format or follow the vault's Obsidian settings.
- Reassign shortcuts, check conflicts, cancel recording, and restore defaults for one or all commands.
- Improve narrow dialogs, search results, note properties, and the links panel. Keep horizontal scrolling within reach on long unwrapped notes.

## 0.3.0 — 2026-11-01

### Graph and navigation

- Explore connected notes in graph tabs, with search, filters, communities and saved graph settings.
- Improve node dragging, layout, zoom-dependent labels and graph interaction.
- Fix immediate note creation and preserve graph tabs during workspace restoration.
- Add native macOS window controls and rounded window corners.
- Include a portable synthetic demonstration vault with 500 English Markdown notes and sample attachments.

### Downloads

- Add release builds for Windows x64 and universal macOS (Apple Silicon and Intel).
- Builds are unsigned; macOS releases are provided for testing and are not notarized.

## 0.2.0 — 2026-10-30

### Writing and connected notes

- Edit Markdown tables inside the note, with row/column plus controls, right-click actions, formatted cell previews and wrapping. Supported tables inside callouts and lists retain their prefixes.
- Edit YAML properties inline: choose a type from its icon, rename fields, use value suggestions and edit lists as chips. Explicit vault-wide type changes preserve unrelated Obsidian settings.
- Insert templates using the configured Obsidian template folder, title/date/time variables and a single undo step. Existing property values are preserved.
- Fold headings and lists. Preview linked notes and heading/block fragments, including unsaved open buffers; embed notes with relative attachments and bounded recursion.
- Support aliases, comments, highlights, callouts, named and inline footnotes, and undoable tasks in supported editing contexts.

### Attachments and rendering

- Import dropped files and pasted images while respecting supported Obsidian attachment preferences and collision-safe naming.
- Show images, audio, video and PDF directly in the note. PDF includes search, text selection, password entry and read-only annotation text.
- Load supported external images/direct media explicitly. Render passive HTML through an allowlist while keeping executable content restricted.

### Interface

- Switch between English and Russian without replacing note buffers or resetting editing history; the preference persists locally.
- Use a compact search/replace panel with navigation icons, case/whole-word/regex toggles, equally sized fields and responsive layouts.
- Scroll the editable filename with the note in Source, Live Preview and Reading.
- Refresh English/Russian documentation with matching interface screenshots and technology-version badges.

### Compatibility and downloads

Notes and attachments remain ordinary vault files. The existing application identifier and storage keys are retained. Saving original Markdown remains explicit; drafts and vault-local trash are separate recovery mechanisms.

The release targets Windows x64 and requires Microsoft Edge WebView2 Runtime. Downloads include a standalone executable, an NSIS installer and SHA-256 checksums. Binaries are unsigned. No automatic updater, synchronization service or Obsidian plugin runtime is included; macOS/Linux are unvalidated.

## 0.1.0 — 2026-10-25

First public preview: local vaults, three writing modes, links, search, attachments, math/diagrams, tabs, themes, draft recovery and recoverable file operations.
