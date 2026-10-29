# Native testing and screenshots

[Русский](native-testing.ru.md) · [Documentation](README.md) · [Project](../README.md)

## Isolated Windows runtime

Native tests use a release build with the opt-in `e2e` feature, a separate application identifier, an explicit test data directory and a dedicated WebView2 profile. Playwright connects through loopback CDP; no extra Chromium download is needed. Ordinary builds do not enable test data overrides.

The harness creates synthetic vaults under ignored `.build-cache/`, operates a hidden child WebView and stops only processes it created. It never types into the user's active application or tests against a personal vault. Artifacts remain for diagnosis; it does not recursively delete test directories.

## Run

```powershell
npm ci
npm run build:e2e
npm run test:e2e
```

Build again after frontend/host changes so the tests exercise matching code. See [Contributing](../CONTRIBUTING.md#optional-cargo-transport) for the optional offline registry cache. Report: `.build-cache/native-results/report.json`; artifacts: `.build-cache/native-results/artifacts/`.

For a focused localization/editor run:

```powershell
npm run test:e2e -- --grep 'language switching|writing workflows:|editor compatibility:|note properties:'
```

The language test verifies the same editor DOM survives switching, user text stays unchanged, undo/redo still works, Save is explicit and language persists across restart. Existing scenarios cover drafts, revisions, rename recovery, navigation, table/property editing, templates and embedded content. Native tests do not benchmark window dragging, FPS or memory.

## Reproduce documentation screenshots

After building the test executable:

```powershell
$env:AETHER_DOC_SCREENSHOTS = '1'
npm run test:e2e -- --grep 'documentation screenshots'
Remove-Item Env:AETHER_DOC_SCREENSHOTS
```

These opt-in captures create separate English/Russian demo vaults, select the actual interface language and save `workspace-dark.png`, `workspace-light.png`, `link-preview.png` and `templates.png` under `docs/screenshots/en/` and `ru/`. They assert that English screens contain no Russian text and original note files remain unchanged. Review both languages and themes visually before publication; screenshots are intentional documentation assets, not personal vault exports.

![English preview capture](screenshots/en/link-preview.png)
