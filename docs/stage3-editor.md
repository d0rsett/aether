# Stage 3: editor rendering record

[Русский](stage3-editor.ru.md) · [Documentation](README.md) · [Project](../README.md)

**Historical engineering milestone.** Original restrictions on tables, note embeds, external images and HTML have since changed. See [interface and compatibility](interface.md) and [Live Preview](live-blocks.md) for the current implementation.

## Rendering contract

Rust parses the current buffer into an inert render tree and source ranges without writing the file. Reading requests are debounced and stale replies ignored. Source and Live Preview preserve CodeMirror state across mode switches; formatting uses ordinary undoable transactions.

Shared vault resolution protects local attachment paths. Image reads validate raster signatures and size limits; later work added bounded PDF/audio/video views and explicit external loading. Navigation separates display labels, resolved files and anchors.

KaTeX uses restricted untrusted input. Mermaid is lazy-loaded and displayed without scripts or same-origin privileges in a sandboxed frame. Raw HTML now uses passive allowlisted reconstruction, superseding the original text-only behavior. Errors preserve access to the rest of the note and its source.

## Remaining limits

There is no dedicated visual math/diagram editor or complete reproduction of Obsidian Live Preview/plugins. Performance targets have not been measured. Current regression coverage and screenshot instructions are in [native testing](native-testing.md).
