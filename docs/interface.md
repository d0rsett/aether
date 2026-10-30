# Interface and Obsidian compatibility

[Русский](interface.ru.md) · [Documentation](README.md) · [Project](../README.md)

## Workspace and languages

The ribbon opens files, search and commands. Tabs and the note toolbar sit above the editor; the vault menu is below the file tree. The right sidebar contains relations and attachments. Properties appear in the note, not in a separate inspector editor.

Sidebars are resizable and collapsible; themes, line numbers and formatting controls are optional. Use the language icon near the window controls or the language command to switch English/Russian. The choice persists in `aether.ui.language`. It changes interface labels, dialogs, accessibility text and supported errors, never note content or filenames. A failed preference write is reported; the selected language remains usable for the current session.

![English workspace](screenshots/en/workspace-dark.png)

## Writing and tables

Source and Live Preview share the editor state; Reading renders the current buffer. Formatting, templates and property/table edits use transactions so undo and unsaved text remain available. Supported headings and lists can be folded. The fold control sits between line numbers and text; collapsed content uses a plain ellipsis.

In tables, click a cell to edit its Markdown; unfocused cells show supported formatting. Use the bottom/right plus controls for rows/columns and right-click for context actions. Long text wraps inside the editor. Supported callout/list prefixes survive edits; ambiguous nested structures remain editable in Source.

## Properties and templates

YAML properties appear as rows with a type icon, name and value. Click the icon for text, number, checkbox, date, date/time or list types. Type assignments apply to the same property name across the vault through `.obsidian/types.json`. Assignments are explicit, revision checked and preserve unrelated settings; note text still requires Save. Add/rename fields inline, edit list chips and use catalog suggestions. Unsupported or mismatched YAML stays accessible in Source.

Templates use the folder in `.obsidian/templates.json`, or `Templates` when unset. Insertion supports title/date/time tokens, merges missing frontmatter fields and forms one undo step. Folder settings are read without modification.

![English template picker](screenshots/en/templates.png)

## Links and media

Supported wiki/Markdown links resolve paths, aliases and heading/block targets through shared vault rules. Hover previews and embeds can use the current unsaved buffer of an open target. Ambiguous targets require a choice. Embeds preserve the linked note's origin for relative resources and have recursion limits.

Local images, PDF, audio and video have dedicated views. PDF supports text selection, search, password entry and read-only annotation text; it does not execute actions/forms. External images/direct media require explicit loading. Web pages open in the external browser. Passive HTML is reconstructed from an allowlist; scripts and arbitrary attributes are never mounted. Mermaid is sandboxed; KaTeX uses untrusted input restrictions.

![English link preview](screenshots/en/link-preview.png)

## Compatibility boundaries

Ordinary Markdown and attachments stay portable. Aether respects supported Obsidian attachment-folder/link preferences and reads aliases, templates and shared property types. It does not implement Obsidian's plugin runtime, Canvas, Bases, sync or every Markdown extension. Complex YAML and unsupported table structures may require Source; there is no dedicated visual math/diagram editor. Compatibility means preserving usable files, not reproducing every Obsidian screen.

Original notes are saved explicitly. Recovery drafts, rename journals and local trash support recovery but do not replace backups.

## Graph view

Open **Graph view** from the left ribbon or command palette. The graph opens as a separate workspace tab; switching to a note keeps the graph and its controls available. Ctrl+W closes the active graph tab. Drag the canvas to pan, scroll to zoom around the pointer, and drag nodes to rearrange them. Click a node or focus it and press Enter to open its note. Hovering highlights its neighbors; more connected notes have larger nodes. The canvas also supports arrow keys and +/−.

Graph settings offer text/path filtering, orphan visibility, local depth (1–5), labels, node size, link thickness and center/repel/link forces. The graph uses saved indexed note links and the shared resolver, including aliases. It does not include unsaved links, missing targets, attachments or tag nodes. Closing the graph returns to the existing editor without replacing its buffer. Settings currently last for the open graph view.
