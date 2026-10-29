# Architecture

[Русский](architecture.ru.md) · [README](../README.md)

## Layers

React owns the workspace reducer, tab/session/draft state and UI. CodeMirror 6 owns source editing and Live Preview decorations/widgets. Reading mode renders the current buffer. `src/services/api.ts` is the typed IPC contract; the frontend does not receive a general filesystem or shell API.

Tauri commands in `src-tauri/src/lib.rs` validate the active vault, coordinate blocking work, show native dialogs, maintain index/watch lifecycle and emit `knowledge:changed`. The independent `aether-core` crate has no Tauri dependency: it implements scoped paths, files, settings, Markdown parsing, link resolution, attachments, indexing, watching and rename transactions. It has its own Cargo workspace and lockfile.

## Sources of truth

Markdown files are authoritative. SQLite FTS5 is a disposable index outside the vault; failures do not make cached text authoritative. Watch events refresh affected entries and the tree. Open buffers are not silently replaced by disk changes. Sidebar relations use saved/indexed data, while Properties uses the current buffer; navigation can parse an open buffer for anchors.

Tabs keep current text, saved text and a revision. Save takes a snapshot; acknowledging it must not erase edits made while a request was pending. BOM/newline metadata is preserved. File revisions detect completed external changes; they are not an interprocess lock.

## Transactions and trash

Writes use temporary files and revision checks; creation does not overwrite existing targets. Rename/move builds a plan from actual vault files, maps supported wiki/Markdown/image/reference links, checks snapshots and writes a journal/backups under `.aether/` before applying. Normal UI applies directly; the explicit preview command exposes the same planning boundary. The backend accepts an operation token rather than arbitrary client-supplied replacement content.

Directory transactions record tree inventory/file hashes, include assets and empty directories, remap descendant notes and tabs, and support the same Undo/recovery flow. Recovery validates current paths/contents before writing. Conflicts preserve the journal for explicit recovery rather than overwriting unrelated changes. Older note journals remain readable.

Trash is separate from rename Undo. Confirmed deletion preserves contents under `.aether/trash/`; folder deletion moves the whole folder. Restoration is manual. The application never treats the OS recycle bin as its trash store.

## Rendering boundary

The Properties block appears inside the editor in Live Preview and at the start of Reading. It parses the current buffer using the YAML document model without resolving aliases. A bounded, vault-scoped read loads `.obsidian/types.json`; unknown or mismatched types remain source-only. The read never modifies the settings. Simple top-level fields are patched by source range; flow maps use document serialization within the header. Unsupported structures remain under source control. Property transactions carry the expected header and are applied to the current CodeMirror document in isolated history transactions, preserving intervening body edits and mapped selections.

Rust parses Markdown into an inert render model. Adjacent raw HTML events are grouped; the frontend parses fragments in an inert template and reconstructs an allowlist of passive React elements, never mounting source DOM or arbitrary attributes. Links/images use existing explicit navigation and vault APIs. Source and Live Preview share a CodeMirror state; mode changes preserve editing history. Inline syntax is revealed at the active fragment; rich blocks reveal their source when selected/edited. Rendering is delayed after edits; stale widgets are removed/mapped rather than applied to unrelated offsets.

Live Preview table cells edit the current buffer through mapped CodeMirror transactions, checking the current source and preserving line separators and history. Cell Markdown is previewed outside focus, and long text wraps. Supported quote and consistently indented list prefixes are preserved; ambiguous structures remain in source. Table alignment travels through the shared render model. Named footnotes navigate within their originating note; Reading remembers the clicked reference and Live Preview maps the return position through edits. Inline footnotes are parsed as structured Markdown and exposed in Reading; their source remains visible in Live Preview. Embedded notes clear editing callbacks and keep an independent navigation scope.

Media reads validate the active vault, attachment resolution, extension/signature and a 64 MiB bounded read. Visible audio/video load lazily and use revoked-on-cleanup Blob URLs. PDF.js is lazy loaded with its worker and font/CMap assets bundled locally; canvas rendering does not mount PDF scripts, annotations or forms. Loading/render tasks cancel on disposal. CSP allows local workers/resources and Blob media while retaining script, frame, object and network restrictions.

Note embeds resolve through the shared link resolver. Rust selects heading/block fragments using navigation ranges after parsing the full document, preserving reference definitions. `NotePreviews` shares current open buffers and index revisions with Reading and the independent Live Preview React roots; embedded content never writes files or edits its host buffer. Nested contexts preserve each note's link/attachment origin. Requests cancel on context/buffer changes; resolved path/anchor chains and depth/count limits bound recursion. Embedded task markers are read-only, with navigation to the original note for edits.

Local image reads are scoped to the vault and capped at 8 MiB. External images and direct media are fetched only on request through a bounded Windows transport, with public addresses checked and redirects revalidated; web pages open in the browser. Mermaid output is displayed in an iframe without scripts, same-origin privileges or network access. KaTeX uses restricted untrusted input. CSP and narrowly scoped Tauri window capabilities limit the frontend; external HTTP(S) opening is an explicit native command.

## Persistence and compatibility

YAML aliases live in a separate indexed table in the disposable cache. Cache schema version 2 rebuilds older note rows without modifying Markdown. Shared link resolution checks real paths/names before aliases; completion returns actual paths and optional aliases so insertion uses canonical wiki destinations with display labels. Index updates refresh link resolutions when aliases change or disappear. Rename planning populates aliases from actual vault contents in both before/after catalogs, preserving alias links and repairing filename shadowing independently of the application index.

`settings.json` stores recent/last vaults under Tauri app data; indexes are alongside it. WebView storage holds UI state, per-vault sessions and drafts. Draft backup runs roughly 700 ms after edits and immediately on normal close/switch; storage failure is reported. Draft restoration never implicitly writes original files.

The Aether rename changes product/title/package/binary names. The stable identifier `app.aether.notes`, `.aether/` metadata and session keys intentionally remain unchanged. Native test builds use a separate identifier, explicit data-directory override and separate WebView profile; ordinary builds do not enable that override.

## Limits and validation

No interprocess lock, adversarial filesystem-race hardening, plugin runtime, encryption, sync or automatic updater is implemented. Symlinks/reparse paths are rejected by supported operations, but path validation does not claim descriptor-relative TOCTOU protection. Filesystem durability also depends on the OS/storage; local drafts are not backups.

Vitest checks state/editor/components and mock IPC orchestration. Rust tests use real temporary files for revisions, traversal, links, transactions/recovery/trash. Windows native E2E uses real Tauri IPC through isolated hidden WebView2/CDP; it is not a performance or native window-drag benchmark. The ordinary release is built separately without the test feature.

Earlier implementation records linked in the README are historical and may describe superseded stage limitations.

Property type assignments can be changed explicitly through `set_property_type`, preserving unrelated JSON fields and rejecting stale type maps and file revisions. Original notes still require explicit save. PDF text layers use PDF.js; password callbacks remain in memory, and annotations are rendered as plain React text without mounting actions or forms.

Writing tools use CodeMirror fold services and mapped editor transactions. Link hover tooltips use the shared Markdown parser, note resolver, and current-buffer preview store; they never fetch arbitrary external pages. Callout widgets retain nested table ranges through document mappings and preserve their React roots and focused cell during edits and undo. Template insertion merges missing YAML fields and inserts the body as one isolated history transaction; YAML aliases in template frontmatter require source simplification. The template picker reads Obsidian folder settings without modifying them and creates new templates through collision-safe vault APIs. Property catalogs are bounded reads and cached briefly in memory; renaming patches only the selected YAML key and checks duplicate and assigned types before changing metadata.
