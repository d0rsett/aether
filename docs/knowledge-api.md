# Knowledge API

[Русский](knowledge-api.ru.md) · [Documentation](README.md) · [Project](../README.md)

## Contract and ownership

`src/services/api.ts` defines typed frontend calls; Rust commands in `src-tauri/src/lib.rs` validate the active vault and delegate filesystem/index rules to `aether-core`. Markdown is authoritative; SQLite FTS5 is rebuildable. Responses from stale note/vault requests must be ignored.

| Area         | Calls and behavior                                                                                                                          |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Search/index | `search_notes`, `inspect_note`, `index_status`; bounded results, parameterized filters, background watch refresh                            |
| Resolution   | `resolve_link`, `link_suggestions`, `locate_anchor`; paths, aliases, heading/block targets and explicit ambiguity                           |
| Rendering    | `render_markdown`, `render_note_fragment`; current buffer to inert nodes and ranges, no file write                                          |
| Attachments  | `read_image`, `read_media`; scoped resolution, validated formats and bounded reads                                                          |
| Properties   | `property_catalog`, `property_types`, `set_property_type`; bounded suggestions, shared types and revision-checked explicit settings updates |
| Templates    | `template_folder`; Obsidian folder setting with validated fallback                                                                          |
| Transactions | `preview_rename`, `rename_preview_page`, `apply_rename`, `rename_state`, `undo_rename`; server-owned plans and recoverable journals         |

See the TypeScript contract and Rust serialization for exact request/response fields. Update both together when changing IPC.

## Resolution and indexing

Wiki resolution checks root paths, neighboring notes, unique basenames and then short-name YAML aliases. Explicit relative paths remain relative and may not escape the vault. Display labels do not define identity; heading/block anchors remain separate targets. Multiple matches return candidates.

Search uses Unicode61 with quoted prefix terms; input is not arbitrary SQL or FTS syntax. Path/tag/property filters are bound parameters. Highlight markers become React text/mark elements. Search pages are bounded; link suggestions carry actual paths and optional display aliases.

The watcher refreshes index/tree data without saving notes or replacing dirty buffers. Rename planning uses actual files rather than trusting the cache. Index failures do not roll back a completed filesystem transaction.

## Bounds and desktop integration

Local raster reads are capped at 8 MiB; PDF/audio/video reads at 64 MiB with format checks. The property catalog bounds traversal, header sizes, names and values; YAML aliases are not expanded. Template settings are bounded and vault scoped.

Folder-picker commands accept optional `language: "ru" | "en"`; omitted language retains Russian compatibility for existing callers. Error details stay structured; supported user-facing messages are translated at the frontend boundary. No general filesystem/shell API is exposed to the renderer.
