use crate::indexing::{Index, IndexStatus};
use crate::vault::Vault;
use crate::{Error, Result};
use notify::{RecommendedWatcher, RecursiveMode, Watcher};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{mpsc, Arc};
use std::time::Duration;

pub struct Watching {
    _watcher: RecommendedWatcher,
    cancel: Arc<AtomicBool>,
}

impl Watching {
    pub fn start(
        vault: Vault,
        index: Arc<Index>,
        changed: Arc<dyn Fn(IndexStatus) + Send + Sync>,
    ) -> Result<Self> {
        let (sender, receiver) = mpsc::channel();
        let mut watcher = notify::recommended_watcher(move |event| {
            let _ = sender.send(event);
        })
        .map_err(|error| Error::Index(error.to_string()))?;
        watcher
            .watch(vault.root(), RecursiveMode::Recursive)
            .map_err(|error| Error::Index(error.to_string()))?;
        let cancel = Arc::new(AtomicBool::new(false));
        let stop = cancel.clone();
        std::thread::Builder::new()
            .name("aether-index".into())
            .spawn(move || {
                let publish = || {
                    if let Ok(status) = index.status() {
                        changed(status);
                    }
                };
                if let Err(error) = index.scan(&vault, &stop, &publish) {
                    index.failure(&error);
                    publish();
                }
                while !stop.load(Ordering::Relaxed) {
                    let event = match receiver.recv_timeout(Duration::from_millis(200)) {
                        Ok(event) => event,
                        Err(mpsc::RecvTimeoutError::Timeout) => continue,
                        Err(_) => break,
                    };
                    let mut paths = std::collections::HashSet::new();
                    let mut collect = |event: notify::Result<notify::Event>| match event {
                        Ok(event) => {
                            if matches!(event.kind, notify::EventKind::Access(_)) {
                                return;
                            }
                            for path in event.paths {
                                paths.insert(path);
                            }
                        }
                        Err(error) => index.failure(&Error::Index(error.to_string())),
                    };
                    collect(event);
                    let deadline = std::time::Instant::now() + Duration::from_millis(250);
                    while let Ok(event) = receiver.recv_timeout(Duration::from_millis(100)) {
                        collect(event);
                        if stop.load(Ordering::Relaxed) {
                            return;
                        }
                        if std::time::Instant::now() >= deadline {
                            break;
                        }
                    }
                    let mut updated = false;
                    for path in paths {
                        if stop.load(Ordering::Relaxed) {
                            return;
                        }
                        let Ok(relative) = path.strip_prefix(vault.root()) else {
                            continue;
                        };
                        let relative = relative.to_string_lossy().replace('\\', "/");
                        if relative.is_empty()
                            || relative
                                .split('/')
                                .any(|part| part.eq_ignore_ascii_case(".aether"))
                            || path
                                .file_name()
                                .is_some_and(|name| name.to_string_lossy().starts_with(".tmp"))
                        {
                            continue;
                        }
                        if path.is_dir() {
                            // A moved-in directory can contain Markdown without individual create events.
                            match index.update_directory(&vault, &path, &stop) {
                                Ok(changed) => updated |= changed,
                                Err(error) => {
                                    index.failure(&error);
                                    updated = true;
                                }
                            }
                        } else {
                            match index.update(&vault, &relative) {
                                Ok(changed) => updated |= changed,
                                Err(error) => {
                                    index.failure(&error);
                                    updated = true;
                                }
                            }
                        }
                    }
                    if updated {
                        publish();
                    }
                }
            })?;
        Ok(Self {
            _watcher: watcher,
            cancel,
        })
    }
}
impl Drop for Watching {
    fn drop(&mut self) {
        self.cancel.store(true, Ordering::Relaxed);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn indexes_external_changes_without_writing_source() -> Result<()> {
        let temp = tempfile::tempdir()?;
        let root = temp.path().join("vault");
        std::fs::create_dir(&root)?;
        let vault = Vault::open(&root)?;
        let index = Arc::new(Index::open(&temp.path().join("cache.sqlite"))?);
        let (sender, receiver) = mpsc::channel();
        let watcher = Watching::start(
            vault,
            index.clone(),
            Arc::new(move |status| {
                let _ = sender.send(status);
            }),
        )?;
        loop {
            let status = receiver
                .recv_timeout(Duration::from_secs(5))
                .map_err(|error| Error::Index(error.to_string()))?;
            if !status.running {
                break;
            }
        }
        std::fs::write(root.join("Внешняя.md"), "# Внешняя\nуникальноеслово")?;
        let deadline = std::time::Instant::now() + Duration::from_secs(5);
        loop {
            if !index
                .search(&crate::indexing::SearchQuery {
                    text: "уникальноеслово".into(),
                    ..Default::default()
                })?
                .hits
                .is_empty()
            {
                break;
            }
            assert!(
                std::time::Instant::now() < deadline,
                "watcher did not index the external edit"
            );
            std::thread::sleep(Duration::from_millis(25));
        }
        assert_eq!(
            std::fs::read_to_string(root.join("Внешняя.md"))?,
            "# Внешняя\nуникальноеслово"
        );
        drop(watcher);
        Ok(())
    }
}
