# Aether

**A local-first Markdown workspace for connected notes.** Built with Tauri 2, Rust, React, TypeScript and CodeMirror 6. Your notes remain ordinary files in a folder you control. No account or cloud service is required.

[Русская документация](README.ru.md) · [Architecture](docs/architecture.md) · [Contributing](CONTRIBUTING.md)

![Aether workspace with a sample vault](docs/screenshots/workspace.png)

## Status

Early desktop application, version 0.1.0. **Windows is the tested platform**; macOS/Linux are not validated. The interface currently uses Russian labels. No signed installer or automatic updater is configured. Performance targets have not been benchmarked.

Previously named **Aether Notes**. The product, package and executable are now **Aether** / `aether`. The internal identifier `app.aether.notes`, vault metadata directory `.aether` and storage keys remain stable to preserve existing settings and drafts.

## Features

- Open/create vaults and switch between up to 20 recent folders. Vault creation is also available on the empty editor screen.
- Nested file tree, horizontal scrolling, inline names, styled context menus and opening files/vaults in Windows Explorer.
- Scrollable editor tabs, large editable note titles, custom window controls, adjustable sidebars and light/dark themes.
- Source, Live Preview and Reading modes, Markdown formatting, tables, local images, KaTeX math and sandboxed Mermaid diagrams. Live Preview reveals syntax when the caret/selection enters the relevant fragment or block.
- Wiki links, heading/block anchors, completion, backlinks/outgoing links, tags and scalar YAML properties.
- SQLite FTS5 search with text, filename, path, tag and property filters; filesystem watching refreshes the tree/index.
- Drag notes between folders or into the root. File moves and file/folder renames update supported wiki/Markdown references, relative images and reference definitions. Short wiki names remain short where resolution is unambiguous.
- Revision-checked saves, rename journals with Undo/recovery, local draft recovery and recoverable file/folder trash.

## Requirements

Running a built Windows executable requires **Microsoft Edge WebView2 Runtime**. Node.js, Rust and Vite are not needed to run it.

For development/builds on Windows:

- Node.js 22.12+ and npm (project checks use Node.js 24).
- Rust stable 1.90+ with the Windows MSVC toolchain.
- Visual Studio / Build Tools: **Desktop development with C++**, MSVC x64/x86 tools and Windows 10/11 SDK.
- WebView2 Runtime and Git.

Use Developer PowerShell if the linker/SDK is not found. `npm run tauri -- info` reports the environment. Initial dependency installation/build needs network access; using the application works offline.

## Development and builds

From the repository root:

```powershell
npm ci
npm run tauri -- dev
```

`npm run dev` starts only a UI preview at `http://127.0.0.1:1420`; filesystem actions require the native host.

Standalone Windows executable:

```powershell
npm run tauri -- build --no-bundle -- --locked
```

Output: `src-tauri/target/release/aether.exe`.

Windows NSIS installer:

```powershell
npm run tauri -- build -- --locked
```

Output: `src-tauri/target/release/bundle/nsis/`. The first installer build may download NSIS; installers are currently unsigned. Other operating systems need their Tauri platform dependencies and an appropriate bundle target; the checked-in target is Windows NSIS. Keep `package-lock.json` and both Cargo lockfiles (host and independent core crate).

## Using Aether

### Vaults and files

Open a folder with Ctrl+O or the vault menu. **Создать хранилище** asks for a name, then opens the parent-folder picker. Existing folders are not overwritten. Vault switching separates tabs/drafts and warns about unsaved work.

The tab-bar plus creates `Новая заметка` in the root. Edit the large title to rename it. Use folder context menus to create notes/subfolders inside that folder. New folders appear immediately as `Новая папка` with inline naming. File/folder names in the tree use Enter/blur to apply and Escape to cancel. Enter names without full paths; collisions produce an error rather than overwriting.

Drag notes onto a folder or root drop area to move them. Supported references are updated from actual Markdown files independently of the index. Folder rename preserves assets/empty subfolders and remaps open tabs. Normal rename applies directly; the command palette also provides an explicit rename preview. Rename Undo and interrupted-operation recovery are separate actions. Recovery may be required before another rename.

### Saving and conflicts

**Ctrl+S writes the original file; automatic saving of original Markdown files is disabled.** Local recovery drafts are stored about 700 ms after typing, and immediately on normal close/vault switching. Restored drafts appear in the editor and reach the original file only when saved.

Drafts are best-effort recovery, not backups: crashes may lose recent input, storage can fill up, and clearing WebView data removes drafts. External changes do not silently replace open text. Saving checks the file revision; reload/save-copy actions help resolve conflicts. Supported save paths preserve BOM and CRLF.

### Links and rendered content

Use `[[Note]]`, `[[Note#Heading]]`, `[[Note#^block-id]]` or `[label](../Note.md#Heading)`. Ctrl+Space requests completion. Source/Live links open with Ctrl+click; Reading links use a normal click. Missing wiki targets can be created after confirmation.

The right sidebar describes the saved/indexed version, which may differ from an unsaved buffer. Heading/block navigation can use the current buffer. Relation lists are limited to 100 links.

PNG/JPEG/GIF/WebP attachments up to 8 MiB are loaded from inside the vault via `![](path)` or `![[path]]`. Remote images and SVG attachments are not loaded. Note embeds currently show link cards. Raw HTML is text. Mermaid uses a sandboxed iframe; KaTeX applies untrusted-input restrictions. HTTP(S) links open in the system browser only after user action.

### Trash and recovery

Deletion asks for confirmation and moves content into `.aether/trash/` inside the vault, **not the Windows Recycle Bin**. Folder trash preserves all contents including binary assets. Restore manually by copying the saved content back to its intended location and refreshing the tree. Rename Undo is separate from trash recovery; references to deleted notes remain unresolved.

Back up vaults separately. Rename recovery validates journal entries and versions and refuses to overwrite unrelated external changes.

## Shortcuts

| Action                | Shortcut        |
| --------------------- | --------------- |
| Open vault / new note | Ctrl+O / Ctrl+N |
| Save / close tab      | Ctrl+S / Ctrl+W |
| Command palette       | Ctrl+P          |
| Vault search          | Ctrl+Shift+F    |
| Find / replace        | Ctrl+F / Ctrl+H |
| Reading / source      | Ctrl+E          |
| Toggle left sidebar   | Ctrl+\          |
| Bold / italic         | Ctrl+B / Ctrl+I |
| Undo / redo           | Ctrl+Z / Ctrl+Y |
| Link completion       | Ctrl+Space      |

## Storage and boundaries

- Notes/attachments stay in the vault. `.aether/` holds transaction journals/backups/trash; preserve it when recovering operations.
- `settings.json` and disposable SQLite indexes live in Tauri's app-data directory for `app.aether.notes`, outside the vault. WebView storage contains UI state, per-vault sessions and drafts. Local data is not encrypted.
- No account, sync backend, telemetry service or plugin execution host is implemented.
- Rust commands scope operations to the active registered vault and reject traversal and unsupported symlink/reparse paths. The frontend has no general filesystem or shell API.
- No interprocess vault lock exists. Revision/path checks do not fully prevent adversarial filesystem races; avoid simultaneous writes from multiple instances.
- The cache is not the source of truth. Close Aether before removing a damaged index to rebuild it; watcher/cache failures are reported while Markdown read/save remains available.

## Checks

```powershell
npm run repo:check
npm run format:check
npm test
npm run build
cargo fmt --manifest-path src-tauri/Cargo.toml --all -- --check
cargo fmt --manifest-path src-tauri/crates/aether-core/Cargo.toml -- --check
cargo test --locked --manifest-path src-tauri/crates/aether-core/Cargo.toml
cargo clippy --locked --manifest-path src-tauri/crates/aether-core/Cargo.toml --all-targets -- -D warnings
cargo clippy --locked --manifest-path src-tauri/Cargo.toml --all-targets --all-features -- -D warnings
```

Native Windows tests use isolated hidden WebView2, temporary vault/settings and a separate profile, without operating your desktop or personal vault:

```powershell
npm run build:e2e
npm run test:e2e
```

No Playwright browser download is needed. Test binary: `src-tauri/target/e2e/release/aether.exe`. Reports/profiles/test vaults go to ignored `.build-cache/`. Distribute ordinary release builds, not the `e2e` feature build.

GitHub Actions runs the repository/format checks, frontend tests/build, Rust tests/Clippy and a Windows release build. Native E2E is a separate local check; no hosted-runner E2E result is claimed.

## Project map

| Path                                           | Purpose                                                          |
| ---------------------------------------------- | ---------------------------------------------------------------- |
| `src/app`, `src/workspace`                     | Orchestration, tabs, sessions and drafts                         |
| `src/editor`, `src/reading`                    | CodeMirror and Markdown rendering                                |
| `src/explorer`, `src/search`, `src/components` | Navigation and interface                                         |
| `src/services/api.ts`                          | Typed native command boundary                                    |
| `src-tauri/src`                                | Native commands, dialogs and index lifecycle                     |
| `src-tauri/crates/aether-core`                 | Independent filesystem, links, Markdown, search and transactions |
| `tests`, `tests/native`                        | Frontend and native integration tests                            |
| `scripts`                                      | Test build, publication audit and optional Cargo helper          |

See [architecture](docs/architecture.md) and [contributing/publishing](CONTRIBUTING.md). Earlier Russian engineering records describe the [editor](docs/stage3-editor.md), [live blocks](docs/live-blocks.md), [knowledge API](docs/knowledge-api.md), [rename journal](docs/stage2-completion.md), [native harness](docs/native-testing.md), [interface](docs/interface.md) and [acceptance history](docs/acceptance.md). Historical records retain former product names and superseded stage limitations; this README and architecture describe current behavior.

Executables belong in GitHub Releases; local data, credentials and caches are excluded from Git. **No project license has been selected**; publishing the source does not itself grant an open-source license. Dependencies retain their own licenses.
