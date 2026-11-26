# Commits, pushes, and releases

[Русский](git-workflow.ru.md) · [Contributing](../CONTRIBUTING.md) · [Project instructions](../AGENTS.md)

Read this guide before creating a commit, pushing changes, or preparing a release. It defines the project's workflow; it does not authorize publication. Follow the user's latest instruction about committing, pushing, branches, and releases. A feature request alone does not authorize a commit or push.

## Commit format

Use Conventional Commits and write the entire message in English:

```text
<type>[optional scope][optional !]: <description>

<Brief problem or user need and resulting behavior.>

- <Meaningful change>
- <Important compatibility detail or edge case>

Validation: <checks actually performed and results>.
Limitations: <significant unverified behavior, when relevant>.

BREAKING CHANGE: <incompatible behavior and migration, when applicable>
```

The body, list, and limitations are optional when unnecessary. A small change may need only a title and a validation paragraph. For substantial work, explain the problem and outcome in one or two sentences, group related changes in a list, and finish with actual validation and material limitations. The breaking-change footer belongs only on an incompatible change.

### Types

| Type       | Use                                                      |
| ---------- | -------------------------------------------------------- |
| `feat`     | New user-facing capability or behavior                   |
| `fix`      | Correction of incorrect behavior                         |
| `perf`     | Performance improvement                                  |
| `refactor` | Internal restructuring without changing behavior         |
| `docs`     | Documentation or documentation screenshots               |
| `style`    | Code formatting only, not visual interface design        |
| `test`     | Tests or test infrastructure without application changes |
| `build`    | Build configuration, packaging, or dependencies          |
| `ci`       | CI workflows and their configuration                     |
| `chore`    | Maintenance that does not fit another type               |
| `revert`   | Reversal of a previous commit; identify it in the body   |

Choose the type from the main outcome. Tests and documentation supporting a feature belong in its `feat` or `fix` commit. Use `fix` for a packaging bug; use `build` for a build-system change without a bug fix. Release preparation uses `chore(release)`.

### Scope and description

Scope is optional. Use a short, stable area such as `editor`, `reading`, `workspace`, `attachments`, `vault`, `graph`, `canvas`, `settings`, `appearance`, `i18n`, or `release`. Omit it when the change spans several areas; do not invent a long compound scope.

Start the description with a lowercase imperative verb: `add`, `fix`, `preserve`, `remove`, `refresh`, or `document`. Aim for 72 characters or fewer for the entire title, without a trailing period. Describe the final scope and outcome rather than filenames, abandoned approaches, or conversation history. Avoid vague titles such as `fix stuff` or `various improvements`.

```text
feat(editor): add heading folding
fix(attachments): map insertion positions through edits
feat(appearance): add graphite themes and Constellation branding
docs: refresh bilingual screenshots
ci: verify release artifacts before upload
chore(release): prepare Aether 1.2.2
```

Use `!` and an explicit `BREAKING CHANGE:` footer for an incompatible change, explaining who is affected and how to migrate. Do not mark an internal refactor or an ordinary bug fix as breaking. For example:

```text
feat(api)!: require revision tokens when saving notes

Reject saves without an expected revision to prevent stale writes.

BREAKING CHANGE: API callers must supply the last-read revision token.
```

Examples illustrate the format; they are not claims about work performed. Conventional Commits do not themselves generate changelogs, choose versions, or publish releases; that automation is not configured here.

## Before committing and pushing

1. Inspect the branch, upstream, remote, working tree, and complete diff. Preserve unrelated changes and user-owned files. Keep each commit focused on one coherent outcome.
2. Run checks appropriate to the change, following [Contributing](../CONTRIBUTING.md). Documentation-only changes generally need formatting and content/link review. Resolve introduced failures and report remaining ones accurately.
3. Stage only requested work. Inspect staged paths and the staged diff; run `git diff --cached --check`. Check ignore rules and tracked files as well as untracked files. Never force-add personal or generated data.
4. Exclude personal vaults, profiles, credentials, databases, caches, executables, and installers. `vault/` is the versioned synthetic demo exception; local additions there are not automatically authorized for publication. If private data is already tracked or committed, stop publication and explain; do not silently delete data or rewrite history.
5. Write multiline messages through a message file or structured argument. Include only checks actually performed; distinguish unit tests, production builds, targeted native scenarios, and manual checks. Record test counts only from confirmed output. A successful build does not establish runtime correctness.
6. After committing, inspect the resulting commit and working-tree status. Before an authorized push, review every outgoing commit for private or generated files. After pushing, verify the intended remote branch and report the commit and destination.

Do not amend published commits, force-push, or rewrite shared history unless explicitly requested. Do not discard or silently include unrelated changes.

## Release format and required artifacts

Use [the bilingual release template](release-template.md), based on [Aether 1.2.1](https://github.com/d0rsett/aether/releases/tag/v1.2.1). Preserve its section order and headings: `## Aether <version> — <English title>`, change bullets, `### Downloads`, `### Verification`, links to checks/builds/source, then `## По-русски`, matching change bullets, download information, and verification information. Finish the entire English block before starting Russian. Do not interleave languages or replace these sections with another outline.

Replace every placeholder with current release facts. Add or remove change bullets according to the actual scope, keeping their meaning and order aligned in both languages. Translate the download and verification information as well as the changes. Keep actual checks and limitations; never copy old test counts, CI links, signing claims, or platform availability blindly. Update the template's platform/signing statements if those facts change. The template does not enable automatic release publication.

Every ordinary release must contain both an installer and a portable distribution for each supported release platform, plus checksums:

| Platform                                | Distribution                 | Asset                                                    |
| --------------------------------------- | ---------------------------- | -------------------------------------------------------- |
| Windows x64                             | NSIS installer               | `Aether_<version>_x64-setup.exe`                         |
| Windows x64                             | Portable executable          | `Aether_<version>_Windows_x64.exe`                       |
| macOS universal (Intel + Apple Silicon) | DMG installer image          | `Aether_<version>_universal.dmg`                         |
| macOS universal (Intel + Apple Silicon) | Portable application archive | `Aether-macos-universal.app.zip` containing `Aether.app` |
| All four downloads                      | SHA-256 manifest             | `SHA256SUMS.txt`                                         |

`.github/workflows/release.yml` builds Windows with `--bundles nsis -- --locked` and macOS with `--target universal-apple-darwin --bundles app,dmg -- --locked`. It copies the same Windows build's executable to the versioned portable filename and archives the same macOS build's application using `ditto --keepParent`. Download both `aether-windows-x64` and `aether-macos-universal` artifacts. Keep all four distributions from the exact final release commit; do not substitute test builds or artifacts from another version. Calculate and attach the checksum manifest after collecting the four files.

Do not silently publish an installer-only, portable-only, or single-platform release. If any required artifact fails, repair and rebuild it before publishing, unless the user explicitly changes the release scope. Keep runtime-testing claims separate from successful cross-platform builds.

## Release checklist

1. Confirm release authorization, the final scope, version, branch, and remote. Inspect existing tags and releases; do not replace an existing public release or move its tag without explicit authorization.
2. Update the frontend package and lockfile, Tauri version, host Cargo manifest and lockfile together. Update both changelogs, README versions/download links, and affected English/Russian guides. Mention version numbers in commit titles only when relevant to release preparation.
3. When screenshots change, use the isolated synthetic-vault capture workflow in [native testing](native-testing.md). Inspect every image for personal paths, folders, usernames, tooltips, and dialogs. Never capture the user's ordinary profile or personal vault.
4. Run relevant checks and build ordinary artifacts without `e2e`. Preserve running applications; use another Cargo target directory when necessary. For native integration changes, prepare a matching test build and run the affected isolated scenarios. Validate icon formats using [visual identity](branding.md).
5. Commit and push only authorized source/documentation changes. Dispatch `.github/workflows/release.yml` with the full final commit SHA; checkout does not accept an abbreviated SHA as a commit. Follow the checks and requested platform builds to completion and resolve failures. Do not substitute old-version binaries or describe unfinished builds as successful.
6. Prepare a draft release for the exact final commit using `docs/release-template.md`, English first and Russian second. Download its successful build artifacts, verify versions, expected architectures, and icons where practical, and attach all four required distributions. Describe available downloads, WebView2 requirements, unsigned/notarized status, actual checks, and runtime limitations accurately.
7. Create `SHA256SUMS.txt` using basenames, not local paths. Verify uploaded sizes and digests against local files. Keep build artifacts in release attachments, outside Git.
8. Publish the authorized release once its files and checks are complete. Verify the public release, tag target, intended Latest/prerelease status, and assets. Report the release link, pushed commit, checks, and significant limitations.
