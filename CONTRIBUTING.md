# Contributing

[Русский](CONTRIBUTING.ru.md) · [README](README.md)

## Set up

Install the [development requirements](README.md#run-and-build), then run `npm ci` and `npm run tauri -- dev`. Use disposable vaults. Keep personal content outside the source tree or under ignored `vaults/`.

Read [architecture](docs/architecture.md) and repository working instructions before substantial changes. Keep vault/path/index rules in `aether-core`, desktop wiring in `src-tauri/src`, typed IPC in `src/services/api.ts`, workspace state in `src/app` and `src/workspace`, editor extensions in `src/editor`, and reading rendering in `src/reading`.

## Preserve the writing workflow

The current editor buffer is authoritative for unsaved text. Use mapped CodeMirror transactions; preserve selection, undo, focus and scrolling. Ignore stale asynchronous results after note/vault switches. Never save original Markdown implicitly. Keep revision checks, conflict recovery, scoped paths and portable vault formats intact.

Use shared themes, icons, menus and dialogs. Provide English and Russian interface strings through `src/i18n`; preserve user-provided text. Localize accessibility labels and errors as well as visible controls. Update both documentation editions together; capture actual localized UI rather than editing labels into screenshots.

## Checks

```powershell
npm test
npm run build
npm run format:check
npm run repo:check
cargo fmt --manifest-path src-tauri/Cargo.toml --all -- --check
cargo fmt --manifest-path src-tauri/crates/aether-core/Cargo.toml -- --check
cargo test --locked --manifest-path src-tauri/crates/aether-core/Cargo.toml
cargo clippy --locked --manifest-path src-tauri/Cargo.toml --all-targets --all-features -- -D warnings
```

Run relevant [native tests](docs/native-testing.md) for desktop integration and inspect visual changes. The core crate has a separate manifest and lockfile. Keep both Cargo lockfiles and `package-lock.json`. CI runs on Windows and also builds the ordinary application. It does not replace local native interaction checks.

Use `npm run format` for frontend, documentation and scripts, and Cargo fmt for Rust. Prefer focused regression tests for meaningful behavior; do not add tests that merely mirror cosmetic implementation details.

## Review and publication

Explain the user-visible result, checks actually performed and remaining limits. Review the complete diff and staged content; stage only related work. Do not include local vaults, profiles, caches, databases, generated binaries, credentials or private paths. `npm run repo:check` helps with repository hygiene but does not replace review.

Inspect the current branch, upstream and remote before an authorized commit/push. Do not force-push or rewrite shared history without explicit authorization. Commit messages use English: an action-led title, brief context, meaningful change bullets, and actual validation/limitations.

## Builds and releases

Build without the `e2e` feature for ordinary use. Never terminate a user's running application to overwrite a locked executable; use a separate Cargo target directory. Publish installers/binaries as release attachments, with Windows/WebView2 requirements, signing status and checksums. Do not commit them. Signing, automatic publishing and updating are not configured; no project license has been selected.

## Optional Cargo transport

Normal builds use crates.io. If large registry responses fail, `node scripts/cargo-registry-proxy.mjs` provides an opt-in loopback transport cache under ignored `.build-cache/registry`. Cargo still verifies checksums; global Cargo configuration is unchanged.

For native test builds with a populated proxy cache:

```powershell
$env:AETHER_CARGO_PROXY = '1'
npm run build:e2e
Remove-Item Env:AETHER_CARGO_PROXY
```

This mode uses offline Cargo. It does not replace the Windows SDK/MSVC prerequisites.
