# Contributing and publishing

[Русский](CONTRIBUTING.ru.md) · [Project documentation](README.md)

## Development changes

Install the tools in the README, run `npm ci`, then `npm run tauri -- dev`. Keep changes focused; cover file operations, link rewriting, conflicts and recovery with meaningful tests. Never use a personal vault for tests. Do not commit `.build-cache/`, local application settings, vault content, credentials or compiled applications.

Run the README checks before submitting a pull request. Run native E2E on Windows for changes to native/UI integration. Keep both README language editions aligned. The separate `aether-core` crate is excluded from the host Cargo workspace, so run its tests/format checks explicitly. Preserve both Cargo lockfiles and `package-lock.json`.

Use `npm run format` for frontend/docs/scripts. Use Cargo fmt for Rust. Windows CI validates the ordinary release build; native tests are a local check. Describe the user-visible result, validation and remaining limitations in a pull request. Do not include logs containing private vault paths or note contents.

## First upload to GitHub

The local repository uses `main`. No remote URL or credentials are embedded. Create an empty GitHub repository (without generating a README/license), then from this project root:

```powershell
npm run repo:check
git status --short --untracked-files=all
git add .
git diff --cached --stat
git diff --cached --check
npm run repo:check
git commit -m "Initial Aether source"
```

Configure your Git name/email if Git asks. Set the remote to the URL of **your** repository and push:

```powershell
git remote add origin <YOUR_GITHUB_REPOSITORY_URL>
git push -u origin main
```

Replace the angle-bracket placeholder before running the command. If `origin` already exists, inspect it with `git remote -v` rather than blindly replacing it. Review the actual staged diff, not just filenames. The audit checks tracked and nonignored untracked files, rejects tracked ignored files, common credential patterns/personal home paths and files over 10 MiB, and probes ignore rules. Pattern checks do not detect every possible secret. Never use `git add -f` to bypass ignores for local data.

The repository intentionally includes source, lockfiles, app icons, documentation, test code and curated synthetic-vault screenshots. Generated `target/`, `dist/`, dependencies, native test profiles/vaults/reports, runtime `.aether/`, local settings/databases, environment files, key material and binaries are excluded. `.env.example` is allowed only for safe placeholder configuration. Ignoring `.aether/` does not protect arbitrary personal note folders: keep real vaults outside this source tree (or under ignored root `vaults/`).

There is no initial commit, remote or push performed by the preparation workflow. A project license has not been selected; choose one deliberately before representing this as an open-source project.

## Releases

Build without the `e2e` feature using the README commands. Test against a disposable vault. Publish `aether.exe`/NSIS installers as GitHub Release attachments, not Git source files. Include version, Windows/WebView2 requirements, signing status and a SHA-256 checksum. Do not ship development profiles, local settings, `.aether/` directories or test vaults. Automatic publishing and signing are not configured.

## Optional Cargo transport workaround

Normal builds use crates.io directly. `scripts/cargo-registry-proxy.mjs` is an opt-in workaround for environments with broken large registry responses; it serves official crates.io/index contents on loopback and caches under ignored `.build-cache/registry`. Cargo still verifies checksums. It does not change global Cargo settings.

In a separate terminal:

```powershell
node scripts/cargo-registry-proxy.mjs
```

For one development command:

```powershell
npm run tauri -- dev -- --config 'source.crates-io.replace-with="aether-local"' --config 'source.aether-local.registry="sparse+http://127.0.0.1:1421/"'
```

For the native test build, with this registry cache already populated:

```powershell
$env:AETHER_CARGO_PROXY = '1'
npm run build:e2e
Remove-Item Env:AETHER_CARGO_PROXY
```

The test helper uses offline Cargo in this mode. Stop the proxy with Ctrl+C afterwards. This is optional transport configuration, not a replacement for the MSVC/SDK prerequisites.
