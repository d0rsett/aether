# Live Preview internals

[Русский](live-blocks.ru.md) · [Documentation](README.md) · [Project](../README.md)

## Shared rendering

The shared Rust Markdown parser supplies rich nodes and UTF-16 source ranges. CodeMirror StateFields own block decorations; ViewPlugins do not change vertical document structure. Source mode omits rich decorations. Reading and widgets reuse rendering components and the same resource restrictions.

Unchanged ranges map through edits; changed blocks reveal source while a debounced parse of the current snapshot is pending. Stale replies after edits, mode changes, vault changes or destruction are ignored. Hidden tabs do not request unnecessary renders.

## Editing and identity

Widget identity includes content/theme/context rather than absolute offsets. Table and property edits validate expected source and use mapped transactions; they preserve selection, undo, line endings and unrelated body edits. Callout tables keep nested source ranges and focused React roots through editing and undo. Ambiguous prefix structures remain in Source.

There must be no external vertical margins on block widgets: CodeMirror measures their height and uses it for caret/selection coordinates. Use internal padding or source blank lines. Asynchronous media height changes request measurement. Destroy handlers release React roots, subscriptions, observers, Blob URLs and pending work.

## Rich content and current buffers

Note previews share unsaved open buffers through the preview store. Each embedded note retains its own link origin and bounded recursion chain; embedded tasks do not edit the parent. Link tooltips use a single themed card and a transparent CodeMirror wrapper.

Images/media, passive HTML, KaTeX and Mermaid keep the same security boundary in Live Preview and Reading. Attachment source links remain accessible for editing. Folding maps through edits; heading controls align with the measured first line of heading text.

## Language changes

React surfaces subscribe to the locale store, including independently mounted widget roots. A CodeMirror Compartment reconfigures editor phrases without replacing the document or editor instance. Existing folding/edit controls update their labels and release subscriptions on destruction. User Markdown is not translated.

Verification must cover caret placement, wrapping, scroll, selection, undo and focus—not just successful rendering. See [native tests](native-testing.md).
