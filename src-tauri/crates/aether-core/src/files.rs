use crate::vault::{is_link, Vault};
use crate::{Error, Result};
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::fs;
use std::io::Write;
use std::path::Path;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Note {
    pub path: String,
    pub content: String,
    pub revision: String,
}

pub fn revision(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}

/// Same-directory staging + flush + OS replacement. Original survives any staging failure.
pub fn atomic_write(path: &Path, bytes: &[u8], replace: bool) -> Result<()> {
    atomic_write_checked(path, bytes, replace, None)
}

fn atomic_write_checked(
    path: &Path,
    bytes: &[u8],
    replace: bool,
    expected: Option<&str>,
) -> Result<()> {
    let parent = path
        .parent()
        .ok_or_else(|| Error::InvalidPath("Нет родительской папки.".into()))?;
    let mut temp = tempfile::NamedTempFile::new_in(parent)?;
    temp.write_all(bytes)?;
    if replace {
        if let Ok(metadata) = fs::metadata(path) {
            temp.as_file().set_permissions(metadata.permissions())?;
        }
    }
    temp.as_file().sync_all()?;
    persist_staged(temp, path, replace, expected, |temp, path, replace| {
        if replace {
            temp.persist(path)
        } else {
            temp.persist_noclobber(path)
        }
    })?;
    #[cfg(unix)]
    fs::File::open(parent)?.sync_all()?;
    Ok(())
}

fn persist_staged(
    mut staged: tempfile::NamedTempFile,
    path: &Path,
    replace: bool,
    expected: Option<&str>,
    mut persist: impl FnMut(
        tempfile::NamedTempFile,
        &Path,
        bool,
    ) -> std::result::Result<fs::File, tempfile::PersistError>,
) -> Result<()> {
    for attempt in 0..=6 {
        if attempt > 0 {
            // A retry must not extend the overwrite window across an external edit.
            if let Some(expected) = expected {
                let current = fs::read(path).map_err(|error| {
                    if error.kind() == std::io::ErrorKind::NotFound {
                        Error::Conflict
                    } else {
                        error.into()
                    }
                })?;
                if revision(&current) != expected {
                    return Err(Error::Conflict);
                }
            }
        }
        match persist(staged, path, replace) {
            Ok(_) => return Ok(()),
            Err(error) if error.error.kind() == std::io::ErrorKind::AlreadyExists => {
                return Err(Error::AlreadyExists)
            }
            Err(error) => {
                let transient =
                    cfg!(windows) && matches!(error.error.raw_os_error(), Some(5 | 32 | 33));
                if !transient || attempt == 6 {
                    return Err(Error::Io(format!(
                        "Не удалось заменить файл {}: {}",
                        path.file_name().unwrap_or_default().to_string_lossy(),
                        error.error
                    )));
                }
                staged = error.file;
                // Blocking worker only; at most 210 ms, never a WebView/UI-thread wait.
                std::thread::sleep(std::time::Duration::from_millis(10 * (attempt + 1)));
            }
        }
    }
    Err(Error::Io("Не удалось завершить запись файла.".into()))
}

impl Vault {
    pub fn read_note(&self, relative: &str) -> Result<Note> {
        let bytes = fs::read(self.note_path(relative)?)?;
        let content = String::from_utf8(bytes.clone())
            .map_err(|_| Error::Io("Файл не является UTF-8. Исходный файл не изменён.".into()))?;
        Ok(Note {
            path: relative.into(),
            content,
            revision: revision(&bytes),
        })
    }

    pub fn save_note(&self, relative: &str, content: &str, expected: &str) -> Result<String> {
        let path = self.note_path(relative)?;
        let current = fs::read(&path).map_err(|e| {
            if e.kind() == std::io::ErrorKind::NotFound {
                Error::Conflict
            } else {
                e.into()
            }
        })?;
        if revision(&current) != expected {
            return Err(Error::Conflict);
        }
        atomic_write_checked(&path, content.as_bytes(), true, Some(expected))?;
        Ok(revision(content.as_bytes()))
    }

    pub fn create_note(&self, relative: &str, content: &str) -> Result<Note> {
        let path = self.note_path(relative)?;
        atomic_write(&path, content.as_bytes(), false)?;
        self.read_note(relative)
    }

    pub fn create_directory(&self, relative: &str) -> Result<()> {
        let path = self.resolve(relative, false)?;
        match fs::create_dir(path) {
            Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => Err(Error::AlreadyExists),
            result => result.map_err(Error::from),
        }
    }

    pub fn rename_empty_directory(&self, relative: &str, name: &str) -> Result<String> {
        if name.is_empty() || name.contains(['/', '\\']) {
            return Err(Error::InvalidPath(
                "Укажите только имя папки без пути.".into(),
            ));
        }
        let source = self.resolve(relative, false)?;
        let prefix = relative.rsplit_once('/').map_or("", |(parent, _)| parent);
        let next = if prefix.is_empty() {
            name.to_owned()
        } else {
            format!("{prefix}/{name}")
        };
        let target = self.resolve(&next, false)?;
        if source == target {
            return Ok(next);
        }
        if !source.is_dir() || fs::read_dir(&source)?.next().is_some() {
            return Err(Error::InvalidPath(
                "Переименование при создании доступно только для пустой папки.".into(),
            ));
        }
        // Reserve the new name exclusively; remove_dir never removes children if the folder changed concurrently.
        self.create_directory(&next)?;
        if let Err(error) = fs::remove_dir(source) {
            let _ = fs::remove_dir(target);
            return Err(error.into());
        }
        Ok(next)
    }

    pub fn rename_note(&self, from: &str, to: &str, expected: &str) -> Result<Note> {
        let source = self.note_path(from)?;
        let target = self.note_path(to)?;
        if self.read_note(from)?.revision != expected {
            return Err(Error::Conflict);
        }
        if source == target {
            return self.read_note(from);
        }
        // hard_link is exclusive: an existing destination is never replaced (also on Unix).
        fs::hard_link(&source, &target).map_err(|e| {
            if e.kind() == std::io::ErrorKind::AlreadyExists {
                Error::AlreadyExists
            } else {
                e.into()
            }
        })?;
        if let Err(e) = fs::remove_file(source) {
            // Leave both copies if rollback fails; never remove the source on a failed rename.
            let _ = fs::remove_file(&target);
            return Err(e.into());
        }
        self.read_note(to)
    }

    /// User deletion is recoverable: move to private vault trash, never unlink the only copy.
    pub fn trash_note(&self, relative: &str, expected: &str) -> Result<String> {
        let source = self.note_path(relative)?;
        if self.read_note(relative)?.revision != expected {
            return Err(Error::Conflict);
        }
        let internal = self.root().join(".aether");
        let trash = internal.join("trash");
        for directory in [&internal, &trash] {
            match fs::create_dir(directory) {
                Ok(()) => {}
                Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => {
                    let metadata = fs::symlink_metadata(directory)?;
                    if is_link(&metadata) || !metadata.is_dir() {
                        return Err(Error::InvalidPath("Небезопасная папка корзины.".into()));
                    }
                }
                Err(e) => return Err(e.into()),
            }
        }
        let target = tempfile::Builder::new()
            .prefix("deleted-")
            .suffix(".md")
            .tempfile_in(&trash)?;
        // Keep a durable copy before removing the source, including on filesystems without hard links.
        let bytes = fs::read(&source)?;
        if revision(&bytes) != expected {
            return Err(Error::Conflict);
        }
        target.as_file().write_all(&bytes)?;
        target.as_file().sync_all()?;
        let (_, kept_path) = target.keep().map_err(|e| Error::Io(e.to_string()))?;
        fs::remove_file(source)?;
        Ok(kept_path.to_string_lossy().into_owned())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[cfg(windows)]
    #[test]
    fn retries_transient_replacement_without_overwriting_external_edits() -> Result<()> {
        let directory = tempfile::tempdir()?;
        let path = directory.path().join("note.md");
        fs::write(&path, "before")?;
        let expected = revision(b"before");
        let mut staged = tempfile::NamedTempFile::new_in(directory.path())?;
        staged.write_all(b"after")?;
        staged.as_file().sync_all()?;
        let mut calls = 0;
        persist_staged(staged, &path, true, Some(&expected), |file, target, _| {
            calls += 1;
            if calls == 1 {
                Err(tempfile::PersistError {
                    file,
                    error: std::io::Error::from_raw_os_error(32),
                })
            } else {
                file.persist(target)
            }
        })?;
        assert_eq!(calls, 2);
        assert_eq!(fs::read_to_string(&path)?, "after");
        fs::write(&path, "before")?;
        let mut staged = tempfile::NamedTempFile::new_in(directory.path())?;
        staged.write_all(b"editor")?;
        let mut calls = 0;
        let result = persist_staged(staged, &path, true, Some(&expected), |file, target, _| {
            calls += 1;
            if calls == 1 {
                let result = fs::write(target, "external");
                assert!(result.is_ok());
                Err(tempfile::PersistError {
                    file,
                    error: std::io::Error::from_raw_os_error(5),
                })
            } else {
                file.persist(target)
            }
        });
        assert!(matches!(result, Err(Error::Conflict)));
        assert_eq!(calls, 1);
        assert_eq!(fs::read_to_string(&path)?, "external");
        Ok(())
    }

    #[test]
    fn unicode_crud_preserves_real_markdown_and_recoverable_trash() -> Result<()> {
        let dir = tempfile::tempdir()?;
        let vault = Vault::open(dir.path())?;
        vault.create_directory("Заметки")?;
        let note = vault.create_note("Заметки/Привет.md", "# Привет\r\n")?;
        assert!(matches!(
            vault.create_note(&note.path, "lost"),
            Err(Error::AlreadyExists)
        ));
        let rev = vault.save_note(&note.path, "# Мир\r\n", &note.revision)?;
        assert_eq!(
            fs::read_to_string(dir.path().join(&note.path))?,
            "# Мир\r\n"
        );
        let note = vault.rename_note(&note.path, "Заметки/Мир.md", &rev)?;
        assert!(!dir.path().join("Заметки/Привет.md").exists());
        let trash = vault.trash_note(&note.path, &note.revision)?;
        assert!(!dir.path().join(&note.path).exists());
        assert_eq!(fs::read_to_string(trash)?, "# Мир\r\n");
        Ok(())
    }

    #[test]
    fn external_edits_block_save_rename_and_delete() -> Result<()> {
        let dir = tempfile::tempdir()?;
        let vault = Vault::open(dir.path())?;
        let note = vault.create_note("note.md", "original")?;
        fs::write(dir.path().join("note.md"), "external")?;
        assert!(matches!(
            vault.save_note("note.md", "editor", &note.revision),
            Err(Error::Conflict)
        ));
        assert!(matches!(
            vault.rename_note("note.md", "new.md", &note.revision),
            Err(Error::Conflict)
        ));
        assert!(matches!(
            vault.trash_note("note.md", &note.revision),
            Err(Error::Conflict)
        ));
        assert_eq!(vault.read_note("note.md")?.content, "external");
        fs::remove_file(dir.path().join("note.md"))?;
        assert!(matches!(
            vault.save_note("note.md", "editor", &note.revision),
            Err(Error::Conflict)
        ));
        Ok(())
    }

    #[test]
    fn empty_folder_naming_never_overwrites_or_removes_existing_contents() -> Result<()> {
        let dir = tempfile::tempdir()?;
        let vault = Vault::open(dir.path())?;
        vault.create_directory("Проект")?;
        vault.create_directory("Проект/Новая папка")?;
        assert_eq!(
            vault.rename_empty_directory("Проект/Новая папка", "Планы")?,
            "Проект/Планы"
        );
        assert!(!vault.resolve("Проект/Новая папка", false)?.exists());
        vault.create_directory("Проект/Занято")?;
        assert!(matches!(
            vault.rename_empty_directory("Проект/Планы", "Занято"),
            Err(Error::AlreadyExists)
        ));
        assert!(vault.resolve("Проект/Планы", false)?.is_dir());
        for name in ["../outside", "a/b", "a\\b", ".aether", "CON", ""] {
            assert!(vault.rename_empty_directory("Проект/Планы", name).is_err());
        }
        vault.create_note("Проект/Планы/Сохранить.md", "keep")?;
        assert!(vault
            .rename_empty_directory("Проект/Планы", "Другое")
            .is_err());
        assert_eq!(
            vault.read_note("Проект/Планы/Сохранить.md")?.content,
            "keep"
        );
        assert!(!vault.resolve("Проект/Другое", false)?.exists());
        Ok(())
    }

    #[test]
    fn rename_never_overwrites_and_large_document_roundtrips() -> Result<()> {
        let dir = tempfile::tempdir()?;
        let vault = Vault::open(dir.path())?;
        let content = "Большая заметка\n".repeat(100_000);
        let note = vault.create_note("large.md", &content)?;
        vault.create_note("existing.md", "keep")?;
        assert!(vault
            .rename_note("large.md", "existing.md", &note.revision)
            .is_err());
        assert_eq!(vault.read_note("existing.md")?.content, "keep");
        assert_eq!(vault.read_note("large.md")?.content, content);
        Ok(())
    }

    #[test]
    fn invalid_utf8_and_missing_parents_do_not_create_or_replace() -> Result<()> {
        let dir = tempfile::tempdir()?;
        let vault = Vault::open(dir.path())?;
        fs::write(dir.path().join("invalid.md"), [0xff])?;
        assert!(vault.read_note("invalid.md").is_err());
        assert!(vault.create_note("missing/new.md", "x").is_err());
        assert_eq!(fs::read(dir.path().join("invalid.md"))?, [0xff]);
        Ok(())
    }
}
