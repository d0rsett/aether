# Project Working Guidelines

These instructions apply throughout this repository. Keep changes focused on the user's request and preserve existing work.

## Project Idea and Product Direction

Aether is a personal workspace for writing, organizing, and connecting knowledge. The goal is to make capturing a thought, developing a note, attaching supporting material, and following connections feel like one continuous workflow in a calm desktop interface.

The user owns the knowledge base: a vault is an ordinary folder containing Markdown notes and attachments. Core writing, navigation, and search should work locally without requiring an account or a cloud service. Application indexes and interface state support these files; they must not become the only way to access the user's content.

Obsidian is the main reference for familiar Markdown workflows and vault compatibility. Existing vaults should be usable with minimal friction, including supported wiki links, aliases, heading and block references, embedded attachments, and attachment settings. Compatibility is a practical goal, not a claim to reproduce every Obsidian feature or third-party plugin. Preserve portable file formats while allowing deliberate Aether interface choices, such as visible image captions.

Use these priorities when making implementation and design decisions:

- **Reliable writing first.** Preserve text, selection, undo history, drafts, and file integrity before adding visual polish or convenience features.
- **A connected workspace.** Make files, tabs, links, backlinks, attachments, and search work together so users can move between related material without losing their place.
- **Readable editing.** Live Preview should make Markdown comfortable to write while keeping its source accessible. Reading mode provides a clean presentation; Source mode remains available for direct control.
- **A coherent interface.** Reuse interaction patterns and visual components across the application. Controls should be discoverable, compact, keyboard-accessible, and useful at different window widths.
- **Portable knowledge.** Avoid proprietary note formats, unnecessary metadata in note bodies, and features that require exporting content before another Markdown application can use it.
- **Incremental, complete workflows.** Develop features through their actual user journey, including creation, editing, navigation, failure handling, and restoration where relevant. Prefer a dependable workflow over disconnected controls.

These principles guide requested work; they do not authorize unrelated features or establish a fixed roadmap. Clearly distinguish existing capabilities from proposed work. Synchronization, collaboration, a plugin runtime, and other substantial systems need their own explicit scope rather than being assumed parts of a task.

## Project Architecture

Aether is a local-first Markdown desktop application built with Tauri 2, Rust, React, TypeScript, and CodeMirror 6. Notes and attachments remain ordinary files in the user's vault. Windows is the currently tested platform; the interface uses Russian labels.

- Read `docs/architecture.md` and `CONTRIBUTING.md` before substantial architectural changes. Inspect the existing implementation before introducing another abstraction or dependency.
- Keep filesystem operations, path validation, indexing, and vault rules in `src-tauri/crates/aether-core/`. Keep Tauri command wiring and desktop integration in `src-tauri/src/`.
- Keep typed frontend-to-host calls in `src/services/api.ts`. Update Rust serialization and TypeScript contracts together when changing command inputs or responses.
- Keep workspace state and transitions in `src/workspace/` and `src/app/`; editor extensions in `src/editor/`; reading-mode rendering in `src/reading/`; reusable interface components in `src/components/`.
- Reuse shared services, components, and styles. Extend an existing implementation instead of creating a separate version for each screen.
- Preserve existing application identifiers, storage keys, and vault metadata formats. If a change requires migration, implement and verify it explicitly.

## Code Quality and Change Scope

- Follow surrounding naming, formatting, and module conventions. Write code identifiers and technical comments in English; keep user-facing text consistent with the Russian interface.
- Prefer small functions and explicit data flow. Extract shared logic when multiple callers need the same behavior, without building speculative frameworks.
- Keep TypeScript types meaningful. Avoid `any`, unchecked assertions, and suppressed compiler or lint errors as substitutes for validating data.
- Validate external input at its boundary, including clipboard data, drag payloads, configuration files, and IPC parameters.
- In Rust, propagate recoverable errors through the existing result/error types. Avoid panics and unchecked `unwrap()` calls for user-controlled input or filesystem operations.
- Handle failures visibly and preserve recoverability. Do not silently swallow save, import, rename, or persistence errors.
- Comment non-obvious constraints and decisions rather than restating the code. Update nearby documentation when behavior changes.
- Keep refactors relevant to the requested change. Do not add dependencies or broadly rewrite working code without a concrete need.

## Editor and Asynchronous State

- Treat the current editor document as the source of truth for unsaved text. Do not replace it with stale parsed, indexed, or on-disk content.
- Use CodeMirror transactions and position mapping for document edits. Preserve selection, undo history, scroll position, and focus across formatting, imports, and mode changes.
- Map asynchronous insertion positions through intervening edits. A completed import must not overwrite text the user typed while it was running.
- Ignore stale asynchronous results after a note or vault switch, component unmount, or editor destruction. Clean up timers, subscriptions, event listeners, and mounted preview roots.
- Preserve drafts when switching tabs and modes. Avoid unnecessary editor remounts or preview replacement while the user types.
- When changing editor layout, verify caret placement, text selection, line-number alignment, wrapping, and horizontal scrolling. Avoid CSS offsets that make visual text disagree with CodeMirror's measured coordinates.
- Keep Source, Live Preview, and Reading behavior consistent where appropriate, while preserving their intentional differences. Attachment source links must remain editable and visible above their Live Preview content.

## Files, Vaults, and Compatibility

- Keep all vault operations scoped to the active vault. Validate paths in the Rust backend; frontend checks alone are insufficient.
- Preserve protections against path traversal, symlink escapes, unsafe filenames, and accidental overwrites when extending file operations.
- Preserve revision checks, conflict handling, BOM and line-ending behavior, rename recovery, and recoverable deletion. Do not replace these with unconditional writes or permanent deletion.
- Do not introduce automatic writes to original Markdown files as a side effect of editing. Original notes are saved explicitly; local recovery drafts are a separate mechanism.
- Keep Markdown and supported Obsidian link formats portable. Resolve aliases, anchors, relative paths, and ambiguous filenames through shared parsing and resolution logic.
- Do not infer file identity from display labels. Group links by resolved destination and preserve distinct heading and block targets.
- Keep attachment imports collision-safe and respect existing size limits and rollback rules. Undoing inserted markup must not delete a file that may already be referenced elsewhere.
- Preserve rendering restrictions for raw HTML, SVG, Mermaid, and external resources. Do not enable executable content to fix a preview issue.

## Interface and Styling

- Follow the existing light and dark themes, spacing conventions, typography, and icon system. Prefer shared theme variables over isolated hard-coded colors.
- Use shared dialog surfaces and menu components so focus handling, dismissal, and appearance remain consistent.
- Align icons, labels, shortcut hints, and counters predictably. Check narrow layouts, long filenames, wrapped text, and expanded/collapsed sidebar sections.
- Prefer existing Lucide or project icons. Do not introduce a separate icon style for a single feature.
- Keep controls accessible: use appropriate button semantics, labels, keyboard navigation, visible focus, and intentional focus restoration after dialogs close.
- Keep implementation details and raw internal errors out of ordinary interface text. Explain failures in terms of the user's action and available recovery.

## Choosing Verification

- Read the current scripts and project instructions rather than assuming commands or tool versions.
- Use `npm test` for frontend behavior and `npm run build` for TypeScript and frontend production-build checks.
- Use `npm run format:check` and `npm run repo:check` for formatting and repository hygiene when relevant.
- For core Rust changes, run the relevant tests with `cargo test --manifest-path src-tauri/crates/aether-core/Cargo.toml`. The core crate has its own manifest and lockfile.
- For host or desktop integration changes, build the Tauri application and use the relevant native scenarios through `npm run test:e2e`. Prepare a matching test build according to the test harness instructions.
- Use isolated temporary vaults for tests. Never run destructive or state-changing test scenarios against the user's personal vault or application profile.
- Add regression coverage for meaningful behavioral fixes. Include realistic edge cases rather than tests that merely duplicate implementation details.
- For visual changes, inspect the affected interface when practical; a successful build alone does not establish correct layout.
- Select checks according to the affected behavior. Avoid repeatedly running broad suites once relevant checks pass unless new changes or unresolved concerns justify it.

## Commit and Push Authorization

- Create commits and push changes when the user requests those actions. A request to implement a feature does not automatically request a commit or push.
- Follow the latest instruction about committing. If the user postpones it, continue development without creating commits until they authorize it again.
- Use the current development branch when requested. Check the branch, upstream, and remote before committing or pushing.
- Do not amend published commits, force-push, or rewrite shared history unless explicitly requested.
- Do not discard unrelated changes or include them silently in a task-specific commit.

## Commit Message Format

Write commit messages in English. Each message must explain the changes to a reviewer who has not read the conversation.

### Title

- Use a short, specific title describing the main outcome.
- Start with an action verb such as `Add`, `Fix`, `Improve`, or `Refactor`.
- Aim for approximately 72 characters or fewer when practical.
- Avoid vague titles such as `Update`, `Fix stuff`, or `Various improvements`.
- Describe the final scope. If the implementation changes during development, update the message accordingly.

### Short Introduction

- After a blank line, write one or two sentences explaining the problem or user need and the resulting behavior.
- Keep this introduction brief; put detailed changes in the list that follows.
- Explain what a user can now do or which incorrect behavior is fixed.

### List of Changes

- Follow the introduction with a bullet list of meaningful changes.
- Explain what was added, fixed, removed, or reorganized and how the application now behaves.
- Group related implementation details under the behavior they support.
- For a broad feature, cover the relevant editor behavior, interface changes, persistence, compatibility, and error handling when those areas actually changed.
- Mention important edge cases or design decisions when they help a reviewer assess the implementation.
- Include technical details when they explain behavior, constraints, or maintenance concerns. Avoid turning the description into a list of filenames.
- Describe the completed implementation. Omit abandoned approaches, conversational history, speculative claims, and unrelated future plans.
- Scale the detail to the change. Small fixes need a brief explanation; larger features need enough detail to review their full scope.

### Validation and Limitations

- Finish with a short account of the checks actually performed and their results.
- Distinguish unit tests, production builds, native integration tests, and manual checks when relevant.
- If only selected integration scenarios were run, describe them as targeted checks. Do not claim the entire suite passed.
- Mention significant known limitations or checks that could not be completed.
- Do not invent test results or imply that a successful build verifies all runtime behavior.
- Record test counts only when confirmed by the relevant run's output.

### Example

```text
Add Obsidian-compatible attachment workflows

Allow users to insert attachments into notes while preserving existing
Obsidian vault settings and keeping attachment links editable in Live Preview.

- Import dropped files using the configured attachment folder and link format.
- Save pasted images in the vault root with unique filenames.
- Keep source links visible above attachment cards while editing their aliases.
- Open images from the file tree in workspace tabs and restore those tabs.
- Group repeated attachment references in the inspector by their resolved file.
- Validate imported paths and file sizes before writing to the vault.

Validation: frontend tests and the production build passed. Targeted native
checks covered clipboard insertion, image tabs, and Live Preview editing.
```

This example illustrates structure. Use only claims and checks that apply to the actual commit.

## Repository Checks Before Committing

- Inspect the working tree and diff to understand the complete scope of pending changes.
- Stage only files belonging to the requested work. Review the staged diff and check it for whitespace errors before committing.
- Run checks appropriate to the change. Application code needs relevant tests and build checks; documentation-only changes generally need formatting and content review.
- Resolve failures introduced by the change. Report remaining failures accurately instead of hiding them or describing checks as successful.
- Use a message file or a structured tool argument for multiline descriptions to preserve real line breaks and literal text.
- After committing, verify the resulting commit and working-tree status.
- After pushing, verify that the intended branch was updated and report the commit identifier and destination.

## Local Data and Privacy

- Keep personal and test vaults under `vaults/` out of Git. This directory contains local testing material and must not be published to GitHub.
- Exclude generated builds, executables, installers, caches, runtime databases, local application state, and machine-specific settings from commits.
- Never include credentials, tokens, private keys, or personal files in repository changes or commit descriptions.
- Confirm that ignore rules cover local data. Ignore rules do not protect files already tracked by Git; inspect tracked and staged paths as well.
- Before pushing, verify that outgoing commits exclude local vault contents and other private or generated files.
- Do not bypass ignore rules with forced additions to include local data.
- Repository scans help detect mistakes but do not replace reviewing staged files and their diff.
- If private data is already tracked or committed, stop publication and explain the finding. Do not silently delete user data or rewrite shared history.

## Development and Verification

- Preserve note contents, unsaved editor changes, and user-owned files while implementing interface and attachment features.
- For Obsidian compatibility work, respect existing vault configuration and file organization. Do not modify Obsidian settings unless the user requests or authorizes that change.
- Use meaningful regression checks for behavioral fixes when appropriate, particularly editor selection, asynchronous insertion, attachment resolution, and workspace restoration.
- Avoid tests that merely repeat the implementation and unrelated checks without a reason.
- Do not terminate the user's running application to replace a locked build. Keep the session intact and report the available updated build's location.
- Summarize completed work, relevant verification results, and material limitations. Claim a commit or push only after that action succeeds.
