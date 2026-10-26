use aether_core::files::Note;
use aether_core::indexing::{Index, IndexStatus, Inspection, SearchPage, SearchQuery};
use aether_core::links::Resolution;
use aether_core::navigation::{self, Location};
use aether_core::renaming::{self, Applied, Plan, Preview, RenameState};
use aether_core::settings::Settings;
use aether_core::vault::{Entry, Vault, VaultInfo};
use aether_core::watching::Watching;
use aether_core::{attachments, rendering};
use aether_core::{Error, Result};
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use tauri::{Emitter, Manager, State};
use tauri_plugin_dialog::DialogExt;

#[derive(Clone)]
struct AppState {
    vault: Arc<Mutex<Option<Session>>>,
    settings_path: PathBuf,
    app: tauri::AppHandle,
    rename_plan: Arc<Mutex<Option<(String, Plan)>>>,
}

struct Session {
    vault: Vault,
    index: Option<Arc<Index>>,
    _watcher: Option<Watching>,
    generation: u64,
    index_error: Option<String>,
}
static GENERATION: AtomicU64 = AtomicU64::new(1);
#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct KnowledgeEvent {
    vault_id: String,
    status: IndexStatus,
}

async fn blocking<T: Send + 'static>(
    work: impl FnOnce() -> Result<T> + Send + 'static,
) -> Result<T> {
    tauri::async_runtime::spawn_blocking(work)
        .await
        .map_err(|e| Error::Io(e.to_string()))?
}

async fn with_vault<T: Send + 'static>(
    state: AppState,
    id: String,
    work: impl FnOnce(&Vault) -> Result<T> + Send + 'static,
) -> Result<T> {
    blocking(move || {
        let guard = state
            .vault
            .lock()
            .map_err(|_| Error::Io("Ошибка состояния хранилища.".into()))?;
        let vault = &guard.as_ref().ok_or(Error::NoVault)?.vault;
        if vault.info().id != id {
            return Err(Error::NoVault);
        }
        work(vault)
    })
    .await
}

async fn with_rename(
    state: AppState,
    id: String,
    work: impl FnOnce(&Vault) -> Result<Applied> + Send + 'static,
) -> Result<Applied> {
    with_changes(state, id, move |vault| {
        let result = work(vault)?;
        let changed = result.changed_paths.clone();
        Ok((result, changed))
    })
    .await
}

async fn with_changes<T: Send + 'static>(
    state: AppState,
    id: String,
    work: impl FnOnce(&Vault) -> Result<(T, Vec<String>)> + Send + 'static,
) -> Result<T> {
    blocking(move || {
        let guard = state.vault.lock().map_err(|_| Error::NoVault)?;
        let session = guard.as_ref().ok_or(Error::NoVault)?;
        if session.vault.info().id != id {
            return Err(Error::NoVault);
        }
        let (result, changed_paths) = work(&session.vault)?;
        // Publish current relations before enabling UI actions after a multi-file change.
        // Cache failure never reverses or misreports an already committed file transaction.
        if let Some(index) = &session.index {
            for path in &changed_paths {
                if let Err(error) = index.update(&session.vault, path) {
                    index.failure(&error);
                    break;
                }
            }
            if let Ok(status) = index.status() {
                let _ = state.app.emit(
                    "knowledge:changed",
                    KnowledgeEvent {
                        vault_id: id,
                        status,
                    },
                );
            }
        }
        Ok(result)
    })
    .await
}

fn activate(state: &AppState, root: PathBuf) -> Result<VaultInfo> {
    let vault = Vault::open(&root)?;
    let info = vault.info();
    let parent = state
        .settings_path
        .parent()
        .ok_or_else(|| Error::Io("Нет каталога данных приложения.".into()))?;
    let opened = Index::open(
        &parent
            .join("indexes")
            .join(aether_core::indexing::cache_name(&info.id)),
    )
    .map(Arc::new);
    let generation = GENERATION.fetch_add(1, Ordering::Relaxed);
    let weak = Arc::downgrade(&state.vault);
    let app = state.app.clone();
    let id = info.id.clone();
    let publish = Arc::new(move |status| {
        if let Some(active) = weak.upgrade() {
            if let Ok(guard) = active.lock() {
                if guard
                    .as_ref()
                    .is_some_and(|session| session.generation == generation)
                {
                    let _ = app.emit(
                        "knowledge:changed",
                        KnowledgeEvent {
                            vault_id: id.clone(),
                            status,
                        },
                    );
                }
            }
        }
    });
    // Search-cache failures must never disable reading and saving Markdown files.
    let (index, watcher, index_error) = match opened {
        Ok(index) => match Watching::start(vault.clone(), index.clone(), publish) {
            Ok(watcher) => (Some(index), Some(watcher), None),
            Err(error) => (None, None, Some(error.to_string())),
        },
        Err(error) => (None, None, Some(error.to_string())),
    };
    let mut guard = state
        .vault
        .lock()
        .map_err(|_| Error::Io("Ошибка состояния хранилища.".into()))?;
    let mut settings = Settings::load(&state.settings_path)?;
    settings.remember(&info.path);
    settings.save(&state.settings_path)?;
    *guard = Some(Session {
        vault,
        index,
        _watcher: watcher,
        generation,
        index_error,
    });
    Ok(info)
}

async fn with_index<T: Send + 'static>(
    state: AppState,
    id: String,
    work: impl FnOnce(&Index) -> Result<T> + Send + 'static,
) -> Result<T> {
    let index = {
        let guard = state
            .vault
            .lock()
            .map_err(|_| Error::Index("Ошибка состояния индекса.".into()))?;
        let session = guard.as_ref().ok_or(Error::NoVault)?;
        if session.vault.info().id != id {
            return Err(Error::NoVault);
        }
        session.index.clone().ok_or_else(|| {
            Error::Index(
                session
                    .index_error
                    .clone()
                    .unwrap_or_else(|| "Индекс недоступен.".into()),
            )
        })?
    };
    blocking(move || work(&index)).await
}

#[tauri::command]
async fn search_notes(
    state: State<'_, AppState>,
    vault_id: String,
    query: SearchQuery,
) -> Result<SearchPage> {
    with_index(state.inner().clone(), vault_id, move |index| {
        index.search(&query)
    })
    .await
}
#[tauri::command]
async fn inspect_note(
    state: State<'_, AppState>,
    vault_id: String,
    path: String,
) -> Result<Inspection> {
    with_index(state.inner().clone(), vault_id, move |index| {
        index.inspect(&path)
    })
    .await
}
#[tauri::command]
async fn resolve_link(
    state: State<'_, AppState>,
    vault_id: String,
    source: String,
    target: String,
) -> Result<Resolution> {
    with_index(state.inner().clone(), vault_id, move |index| {
        let resolution = index.resolve(&source, &target)?;
        if resolution.status != "resolved" && index.status()?.running {
            return Err(Error::Index("Дождитесь завершения индексации.".into()));
        }
        Ok(resolution)
    })
    .await
}
#[tauri::command]
async fn index_status(state: State<'_, AppState>, vault_id: String) -> Result<IndexStatus> {
    let guard = state
        .vault
        .lock()
        .map_err(|_| Error::Index("Ошибка состояния индекса.".into()))?;
    let session = guard.as_ref().ok_or(Error::NoVault)?;
    if session.vault.info().id != vault_id {
        return Err(Error::NoVault);
    }
    match &session.index {
        Some(index) => index.status(),
        None => Ok(IndexStatus {
            errors: 1,
            message: session.index_error.clone(),
            ..IndexStatus::default()
        }),
    }
}

#[tauri::command]
async fn restore_vault(state: State<'_, AppState>) -> Result<Option<VaultInfo>> {
    let state = state.inner().clone();
    blocking(move || {
        let settings = Settings::load(&state.settings_path)?;
        settings
            .last_vault
            .map(|path| activate(&state, PathBuf::from(path)))
            .transpose()
    })
    .await
}

#[tauri::command]
async fn choose_vault(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<Option<VaultInfo>> {
    let state = state.inner().clone();
    blocking(move || {
        let selected = app
            .dialog()
            .file()
            .set_title("Открыть хранилище Aether")
            .blocking_pick_folder();
        selected
            .map(|path| {
                let path = path
                    .into_path()
                    .map_err(|e| Error::InvalidPath(e.to_string()))?;
                activate(&state, path)
            })
            .transpose()
    })
    .await
}

#[tauri::command]
async fn list_vaults(state: State<'_, AppState>) -> Result<Vec<VaultInfo>> {
    let settings_path = state.settings_path.clone();
    blocking(move || {
        Ok(Settings::load(&settings_path)?
            .vault_paths()
            .into_iter()
            .map(|path| {
                let name = std::path::Path::new(&path)
                    .file_name()
                    .map_or_else(|| path.clone(), |name| name.to_string_lossy().into_owned());
                VaultInfo {
                    id: path.clone(),
                    name,
                    path,
                }
            })
            .collect())
    })
    .await
}
#[tauri::command]
async fn switch_vault(state: State<'_, AppState>, vault_id: String) -> Result<VaultInfo> {
    let state = state.inner().clone();
    blocking(move || {
        if !Settings::load(&state.settings_path)?
            .vault_paths()
            .contains(&vault_id)
        {
            return Err(Error::InvalidPath(
                "Хранилище отсутствует в списке. Откройте его через выбор папки.".into(),
            ));
        }
        activate(&state, PathBuf::from(vault_id))
    })
    .await
}
#[tauri::command]
async fn choose_vault_parent(app: tauri::AppHandle) -> Result<Option<String>> {
    blocking(move || {
        app.dialog()
            .file()
            .set_title("Выберите папку для нового хранилища")
            .blocking_pick_folder()
            .map(|path| {
                path.into_path()
                    .map(|path| path.to_string_lossy().into_owned())
                    .map_err(|e| Error::InvalidPath(e.to_string()))
            })
            .transpose()
    })
    .await
}

#[tauri::command]
async fn create_vault(
    state: State<'_, AppState>,
    name: String,
    parent: String,
) -> Result<VaultInfo> {
    let state = state.inner().clone();
    blocking(move || {
        let parent = PathBuf::from(parent.trim());
        if !parent.is_absolute() {
            return Err(Error::InvalidPath("Укажите полный путь к папке.".into()));
        }
        let created = Vault::create_child(&parent, &name)?;
        activate(&state, created.root().to_path_buf())
    })
    .await
}

#[tauri::command]
async fn list_directory(
    state: State<'_, AppState>,
    vault_id: String,
    path: String,
) -> Result<Vec<Entry>> {
    with_vault(state.inner().clone(), vault_id, move |v| v.list(&path)).await
}

#[tauri::command]
async fn read_note(state: State<'_, AppState>, vault_id: String, path: String) -> Result<Note> {
    with_vault(state.inner().clone(), vault_id, move |v| v.read_note(&path)).await
}

#[tauri::command]
async fn save_note(
    state: State<'_, AppState>,
    vault_id: String,
    path: String,
    content: String,
    revision: String,
) -> Result<String> {
    with_vault(state.inner().clone(), vault_id, move |v| {
        renaming::assert_writable(v, &path)?;
        v.save_note(&path, &content, &revision)
    })
    .await
}

#[tauri::command]
async fn create_note(
    state: State<'_, AppState>,
    vault_id: String,
    path: String,
    content: String,
) -> Result<Note> {
    with_vault(state.inner().clone(), vault_id, move |v| {
        renaming::assert_writable(v, &path)?;
        v.create_note(&path, &content)
    })
    .await
}

#[tauri::command]
async fn create_directory(
    state: State<'_, AppState>,
    vault_id: String,
    path: String,
) -> Result<()> {
    with_vault(state.inner().clone(), vault_id, move |v| {
        v.create_directory(&path)
    })
    .await
}

#[tauri::command]
async fn preview_rename(
    state: State<'_, AppState>,
    vault_id: String,
    path: String,
    new_path: String,
    revision: String,
    open_paths: Vec<String>,
) -> Result<Preview> {
    let plans = state.rename_plan.clone();
    with_vault(state.inner().clone(), vault_id, move |v| {
        let plan = Plan::prepare(v, &path, &new_path, &revision)?;
        let preview = plan.preview(&open_paths, 0);
        *plans
            .lock()
            .map_err(|_| Error::Transaction("Ошибка плана переименования.".into()))? =
            Some((v.info().id, plan));
        Ok(preview)
    })
    .await
}

#[tauri::command]
async fn rename_empty_directory(
    state: State<'_, AppState>,
    vault_id: String,
    path: String,
    name: String,
) -> Result<String> {
    with_vault(state.inner().clone(), vault_id, move |vault| {
        vault.rename_empty_directory(&path, &name)
    })
    .await
}

#[tauri::command]
async fn rename_directory(
    state: State<'_, AppState>,
    vault_id: String,
    path: String,
    name: String,
) -> Result<Applied> {
    with_rename(state.inner().clone(), vault_id, move |vault| {
        Plan::prepare_directory(vault, &path, &name)?.apply(vault)
    })
    .await
}

#[tauri::command]
async fn trash_directory(
    state: State<'_, AppState>,
    vault_id: String,
    path: String,
) -> Result<renaming::FolderTrash> {
    with_changes(state.inner().clone(), vault_id, move |vault| {
        let result = renaming::trash_directory(vault, &path)?;
        let paths = result.changed_paths.clone();
        Ok((result, paths))
    })
    .await
}

#[tauri::command]
async fn rename_preview_page(
    state: State<'_, AppState>,
    vault_id: String,
    token: String,
    offset: usize,
    open_paths: Vec<String>,
) -> Result<Preview> {
    let plans = state.rename_plan.clone();
    with_vault(state.inner().clone(), vault_id, move |v| {
        let guard = plans.lock().map_err(|_| Error::Conflict)?;
        let (id, plan) = guard.as_ref().ok_or(Error::Conflict)?;
        let preview = plan.preview(&open_paths, offset);
        if *id != v.info().id || preview.token != token {
            return Err(Error::Conflict);
        }
        Ok(preview)
    })
    .await
}
#[tauri::command]
async fn apply_rename(
    state: State<'_, AppState>,
    vault_id: String,
    token: String,
) -> Result<Applied> {
    let plans = state.rename_plan.clone();
    with_rename(state.inner().clone(), vault_id, move |v| {
        let mut guard = plans.lock().map_err(|_| Error::Conflict)?;
        let (id, plan) = guard.as_ref().ok_or(Error::Conflict)?;
        if *id != v.info().id || plan.preview(&[], 0).token != token {
            return Err(Error::Conflict);
        }
        let (_, plan) = guard.take().ok_or(Error::Conflict)?;
        plan.apply(v)
    })
    .await
}
#[tauri::command]
async fn rename_state(
    state: State<'_, AppState>,
    vault_id: String,
    open_paths: Vec<String>,
) -> Result<Option<RenameState>> {
    with_vault(state.inner().clone(), vault_id, move |v| {
        renaming::state(v, &open_paths)
    })
    .await
}
#[tauri::command]
async fn undo_rename(
    state: State<'_, AppState>,
    vault_id: String,
    id: String,
    recover: bool,
) -> Result<Applied> {
    with_rename(state.inner().clone(), vault_id, move |v| {
        renaming::undo(v, &id, recover)
    })
    .await
}
#[tauri::command]
async fn locate_anchor(
    state: State<'_, AppState>,
    vault_id: String,
    path: String,
    content: String,
    anchor: String,
) -> Result<Location> {
    with_vault(state.inner().clone(), vault_id, move |v| {
        v.note_path(&path)?;
        navigation::locate(&content, &anchor)
    })
    .await
}

#[tauri::command]
async fn trash_note(
    state: State<'_, AppState>,
    vault_id: String,
    path: String,
    revision: String,
) -> Result<String> {
    with_vault(state.inner().clone(), vault_id, move |v| {
        renaming::assert_writable(v, &path)?;
        v.trash_note(&path, &revision)
    })
    .await
}

#[tauri::command]
async fn render_markdown(
    state: State<'_, AppState>,
    vault_id: String,
    path: String,
    content: String,
) -> Result<rendering::Document> {
    with_vault(state.inner().clone(), vault_id, move |v| {
        v.note_path(&path)?;
        rendering::render(&content)
    })
    .await
}
#[tauri::command]
async fn anchor_options(
    state: State<'_, AppState>,
    vault_id: String,
    path: String,
    content: String,
) -> Result<Vec<String>> {
    with_vault(state.inner().clone(), vault_id, move |v| {
        v.note_path(&path)?;
        if content.len() > 4 * 1024 * 1024 {
            return Ok(Vec::new());
        }
        let mut options: Vec<_> = aether_core::markdown::parse(&content)
            .headings
            .into_iter()
            .take(100)
            .map(|h| h.title)
            .collect();
        let mut seen = std::collections::HashSet::new();
        for line in content.lines() {
            if let Some(word) = line
                .split_whitespace()
                .last()
                .filter(|w| w.starts_with('^'))
            {
                if seen.len() >= 32 {
                    break;
                }
                if seen.insert(word.to_owned())
                    && aether_core::navigation::locate(&content, word).is_ok()
                {
                    options.push(word.into());
                }
            }
        }
        Ok(options)
    })
    .await
}
#[tauri::command]
async fn read_image(
    state: State<'_, AppState>,
    vault_id: String,
    source: String,
    target: String,
    wiki: bool,
) -> Result<String> {
    with_vault(state.inner().clone(), vault_id, move |v| {
        attachments::image(v, &source, &target, wiki)
    })
    .await
}
#[tauri::command]
async fn document_link(
    state: State<'_, AppState>,
    vault_id: String,
    source: String,
    target: String,
) -> Result<String> {
    with_vault(state.inner().clone(), vault_id, move |v| {
        v.note_path(&source)?;
        let (path, anchor) = target.split_once('#').unwrap_or((&target, ""));
        let resolved = if path.is_empty() {
            source
        } else {
            attachments::relative_target(&source, path)?
        };
        v.note_path(&resolved)?;
        Ok(if anchor.is_empty() {
            resolved
        } else {
            format!("{resolved}#{anchor}")
        })
    })
    .await
}
#[tauri::command]
async fn open_external(url: String) -> Result<()> {
    blocking(move || {
        let parsed = tauri::Url::parse(&url).map_err(|e| Error::InvalidPath(e.to_string()))?;
        if !matches!(parsed.scheme(), "http" | "https")
            || parsed.host_str().is_none()
            || url.chars().any(char::is_control)
        {
            return Err(Error::InvalidPath(
                "Доступны только http/https ссылки.".into(),
            ));
        }
        #[cfg(windows)]
        {
            let wide: Vec<u16> = parsed.as_str().encode_utf16().chain(Some(0)).collect();
            // Validated URL is passed as a file argument, never through a shell command string.
            let result = unsafe {
                windows_sys::Win32::UI::Shell::ShellExecuteW(
                    std::ptr::null_mut(),
                    std::ptr::null(),
                    wide.as_ptr(),
                    std::ptr::null(),
                    std::ptr::null(),
                    1,
                )
            };
            if result as isize <= 32 {
                return Err(Error::Io("Не удалось открыть браузер.".into()));
            }
        }
        #[cfg(not(windows))]
        {
            let program = if cfg!(target_os = "macos") {
                "open"
            } else {
                "xdg-open"
            };
            std::process::Command::new(program)
                .arg(parsed.as_str())
                .spawn()?;
        }
        Ok(())
    })
    .await
}

#[tauri::command]
async fn reveal_in_explorer(
    state: State<'_, AppState>,
    vault_id: String,
    path: String,
) -> Result<()> {
    with_vault(state.inner().clone(), vault_id, move |vault| {
        let target = vault.resolve(&path, true)?;
        let metadata = std::fs::metadata(&target)?;
        #[cfg(windows)]
        {
            use windows_sys::Win32::{
                Foundation::RPC_E_CHANGED_MODE,
                System::Com::{
                    CoInitializeEx, CoTaskMemFree, CoUninitialize, COINIT_APARTMENTTHREADED,
                },
                UI::Shell::{SHOpenFolderAndSelectItems, SHParseDisplayName, ShellExecuteW},
            };
            let raw = target.to_string_lossy();
            let shell_path = if let Some(unc) = raw.strip_prefix("\\\\?\\UNC\\") {
                format!("\\\\{unc}")
            } else {
                raw.strip_prefix("\\\\?\\").unwrap_or(&raw).to_owned()
            };
            let wide: Vec<u16> = shell_path.encode_utf16().chain(Some(0)).collect();
            if metadata.is_dir() {
                let action: Vec<u16> = "open".encode_utf16().chain(Some(0)).collect();
                let result = unsafe {
                    ShellExecuteW(
                        std::ptr::null_mut(),
                        action.as_ptr(),
                        wide.as_ptr(),
                        std::ptr::null(),
                        std::ptr::null(),
                        1,
                    )
                };
                if result as isize <= 32 {
                    return Err(Error::Io("Не удалось открыть папку в проводнике.".into()));
                }
            } else {
                let initialized =
                    unsafe { CoInitializeEx(std::ptr::null(), COINIT_APARTMENTTHREADED as u32) };
                if initialized < 0 && initialized != RPC_E_CHANGED_MODE {
                    return Err(Error::Io("Не удалось инициализировать проводник.".into()));
                }
                let mut item = std::ptr::null_mut();
                let parsed = unsafe {
                    SHParseDisplayName(
                        wide.as_ptr(),
                        std::ptr::null_mut(),
                        &mut item,
                        0,
                        std::ptr::null_mut(),
                    )
                };
                let result = if parsed >= 0 {
                    unsafe { SHOpenFolderAndSelectItems(item, 0, std::ptr::null(), 0) }
                } else {
                    parsed
                };
                if !item.is_null() {
                    unsafe { CoTaskMemFree(item.cast()) };
                }
                if initialized >= 0 {
                    unsafe { CoUninitialize() };
                }
                if result < 0 {
                    return Err(Error::Io("Не удалось показать файл в проводнике.".into()));
                }
            }
        }
        #[cfg(not(windows))]
        {
            let mut command = std::process::Command::new(if cfg!(target_os = "macos") {
                "open"
            } else {
                "xdg-open"
            });
            if cfg!(target_os = "macos") && !metadata.is_dir() {
                command.arg("-R");
            }
            let location = if !cfg!(target_os = "macos") && !metadata.is_dir() {
                target
                    .parent()
                    .ok_or_else(|| Error::InvalidPath("Нет родительской папки.".into()))?
            } else {
                target.as_path()
            };
            command.arg(location).spawn()?;
        }
        Ok(())
    })
    .await
}

pub fn run() {
    let result = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            #[cfg(windows)]
            if let Some(window) = app.get_webview_window("main") {
                window.with_webview(|webview| {
                    use webview2_com::Microsoft::Web::WebView2::Win32::{
                        ICoreWebView2Settings3, ICoreWebView2Settings4, ICoreWebView2Settings6,
                    };
                    use windows_core::Interface;
                    // Keep native browser UI out of the workspace; app menus and dialogs
                    // are rendered by React and do not depend on these WebView features.
                    let configure = || -> windows_core::Result<()> {
                        unsafe {
                            let core = webview.controller().CoreWebView2()?;
                            let settings = core.Settings()?;
                            settings.SetAreDefaultContextMenusEnabled(false)?;
                            settings.SetAreDefaultScriptDialogsEnabled(false)?;
                            settings.SetIsStatusBarEnabled(false)?;
                            settings.SetAreDevToolsEnabled(cfg!(debug_assertions))?;
                            settings
                                .cast::<ICoreWebView2Settings3>()?
                                .SetAreBrowserAcceleratorKeysEnabled(false)?;
                            settings
                                .cast::<ICoreWebView2Settings4>()?
                                .SetIsGeneralAutofillEnabled(false)?;
                            settings
                                .cast::<ICoreWebView2Settings6>()?
                                .SetIsPasswordAutosaveEnabled(false)?;
                            let mut token = 0;
                            core.add_NewWindowRequested(
                                &webview2_com::NewWindowRequestedEventHandler::create(Box::new(
                                    |_, args| {
                                        if let Some(args) = args {
                                            args.SetHandled(true)?;
                                        }
                                        Ok(())
                                    },
                                )),
                                &mut token,
                            )?;
                        }
                        Ok(())
                    };
                    if let Err(error) = configure() {
                        eprintln!("Could not configure workspace WebView: {error}");
                    }
                })?;
            }
            let settings_path = app.path().app_data_dir()?.join("settings.json");
            // Compiled only into the isolated native acceptance binary, never the shipped app.
            #[cfg(feature = "e2e")]
            let settings_path = std::env::var_os("AETHER_E2E_DATA_DIR")
                .map(|directory| PathBuf::from(directory).join("settings.json"))
                .unwrap_or(settings_path);
            app.manage(AppState {
                vault: Arc::new(Mutex::new(None)),
                settings_path,
                app: app.handle().clone(),
                rename_plan: Arc::new(Mutex::new(None)),
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            restore_vault,
            choose_vault,
            list_vaults,
            switch_vault,
            create_vault,
            choose_vault_parent,
            list_directory,
            read_note,
            save_note,
            create_note,
            create_directory,
            rename_empty_directory,
            rename_directory,
            trash_directory,
            preview_rename,
            rename_preview_page,
            apply_rename,
            rename_state,
            undo_rename,
            locate_anchor,
            render_markdown,
            anchor_options,
            read_image,
            document_link,
            open_external,
            reveal_in_explorer,
            trash_note,
            search_notes,
            inspect_note,
            resolve_link,
            index_status
        ])
        .run(tauri::generate_context!());
    if let Err(error) = result {
        eprintln!("Aether could not start: {error}");
        std::process::exit(1);
    }
}
