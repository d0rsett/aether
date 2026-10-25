use crate::{Error, Result};
use serde::Serialize;
use std::fs;
use std::path::{Component, Path, PathBuf};

#[derive(Debug, Clone)]
pub struct Vault {
    root: PathBuf,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VaultInfo {
    pub id: String,
    pub name: String,
    pub path: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Entry {
    pub path: String,
    pub name: String,
    pub is_directory: bool,
}

pub fn is_link(metadata: &fs::Metadata) -> bool {
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        metadata.file_attributes() & 0x400 != 0
    }
    #[cfg(not(windows))]
    {
        metadata.file_type().is_symlink()
    }
}

impl Vault {
    pub fn create_child(parent: &Path, name: &str) -> Result<Self> {
        if name.is_empty()
            || name.contains(['/', '\\'])
            || !matches!(
                Path::new(name).components().next(),
                Some(Component::Normal(_))
            )
        {
            return Err(Error::InvalidPath("Введите имя папки без пути.".into()));
        }
        let parent = Self::open(parent)?;
        parent.create_directory(name)?;
        Self::open(&parent.resolve(name, false)?)
    }
    pub fn open(root: &Path) -> Result<Self> {
        let root = root.canonicalize()?;
        if !root.is_dir() {
            return Err(Error::InvalidPath("Выберите папку хранилища.".into()));
        }
        Ok(Self { root })
    }

    pub fn root(&self) -> &Path {
        &self.root
    }

    pub fn info(&self) -> VaultInfo {
        let path = self.root.to_string_lossy().into_owned();
        VaultInfo {
            id: path.clone(),
            name: self
                .root
                .file_name()
                .unwrap_or_default()
                .to_string_lossy()
                .into_owned(),
            path,
        }
    }

    /// Only normal components, no symlinks/junctions, hidden internal storage or ADS.
    pub fn resolve(&self, relative: &str, allow_root: bool) -> Result<PathBuf> {
        if relative.is_empty() && allow_root {
            return Ok(self.root.clone());
        }
        if relative.is_empty() || relative.contains('\\') {
            return Err(Error::InvalidPath(
                "Ожидается относительный путь через /".into(),
            ));
        }
        let mut path = self.root.clone();
        for component in Path::new(relative).components() {
            let Component::Normal(name) = component else {
                return Err(Error::InvalidPath(
                    "Путь выходит за пределы хранилища.".into(),
                ));
            };
            let name_str = name.to_string_lossy();
            let stem = name_str
                .split('.')
                .next()
                .unwrap_or_default()
                .to_uppercase();
            if name_str.eq_ignore_ascii_case(".aether")
                || name_str.ends_with(['.', ' '])
                || name_str
                    .chars()
                    .any(|c| c.is_control() || "<>:\"|?*".contains(c))
                || matches!(stem.as_str(), "CON" | "PRN" | "AUX" | "NUL")
                || ((stem.starts_with("COM") || stem.starts_with("LPT"))
                    && stem.len() == 4
                    && matches!(stem.as_bytes()[3], b'1'..=b'9'))
            {
                return Err(Error::InvalidPath("Недопустимое имя файла.".into()));
            }
            path.push(name);
            match fs::symlink_metadata(&path) {
                Ok(metadata) if is_link(&metadata) => {
                    return Err(Error::InvalidPath(
                        "Символические ссылки и junction не поддерживаются.".into(),
                    ));
                }
                Err(e) if e.kind() != std::io::ErrorKind::NotFound => return Err(e.into()),
                _ => {}
            }
        }
        Ok(path)
    }

    /// Lazy traversal: IPC returns one folder at a time, never file contents.
    pub fn list(&self, relative: &str) -> Result<Vec<Entry>> {
        let directory = self.resolve(relative, true)?;
        let mut entries = Vec::new();
        for entry in fs::read_dir(directory)? {
            let entry = entry?;
            let metadata = fs::symlink_metadata(entry.path())?;
            let name = entry.file_name().to_string_lossy().into_owned();
            if is_link(&metadata) || name.eq_ignore_ascii_case(".aether") {
                continue;
            }
            if metadata.is_dir() || is_markdown(&entry.path()) {
                entries.push(Entry {
                    path: if relative.is_empty() {
                        name.clone()
                    } else {
                        format!("{relative}/{name}")
                    },
                    name,
                    is_directory: metadata.is_dir(),
                });
            }
        }
        entries.sort_by(|a, b| {
            b.is_directory
                .cmp(&a.is_directory)
                .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
        });
        Ok(entries)
    }

    pub fn note_path(&self, relative: &str) -> Result<PathBuf> {
        let path = self.resolve(relative, false)?;
        if !is_markdown(&path) {
            return Err(Error::InvalidPath(
                "Поддерживаются только .md и .markdown.".into(),
            ));
        }
        Ok(path)
    }
}

fn is_markdown(path: &Path) -> bool {
    path.extension()
        .and_then(|s| s.to_str())
        .is_some_and(|s| s.eq_ignore_ascii_case("md") || s.eq_ignore_ascii_case("markdown"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_escapes_and_windows_special_paths() -> Result<()> {
        let dir = tempfile::tempdir()?;
        let vault = Vault::open(dir.path())?;
        for path in [
            "../outside.md",
            "/outside.md",
            "C:/file.md",
            "x:stream.md",
            ".aether/config.md",
            "CON.md",
            "file. /x.md",
            "x\\y.md",
        ] {
            assert!(vault.note_path(path).is_err(), "{path}");
        }
        Ok(())
    }

    #[test]
    fn lists_unicode_nested_markdown_and_skips_internal_files() -> Result<()> {
        let dir = tempfile::tempdir()?;
        fs::create_dir(dir.path().join("Заметки"))?;
        fs::create_dir(dir.path().join(".aether"))?;
        fs::write(dir.path().join("Заметки/Привет.MD"), "Привет")?;
        fs::write(dir.path().join("image.png"), [])?;
        let vault = Vault::open(dir.path())?;
        assert_eq!(vault.list("")?.len(), 1);
        assert_eq!(vault.list("Заметки")?[0].path, "Заметки/Привет.MD");
        Ok(())
    }
    #[test]
    fn creates_named_vault_without_overwriting_existing_folder_or_escaping_parent() -> Result<()> {
        let temp = tempfile::tempdir()?;
        let created = Vault::create_child(temp.path(), "Новые заметки")?;
        assert_eq!(created.info().name, "Новые заметки");
        created.create_note("keep.md", "keep")?;
        assert!(matches!(
            Vault::create_child(temp.path(), "Новые заметки"),
            Err(Error::AlreadyExists)
        ));
        assert_eq!(created.read_note("keep.md")?.content, "keep");
        for name in [
            "",
            "..",
            "../outside",
            "nested/name",
            "nested\\name",
            ".aether",
            "CON",
        ] {
            assert!(Vault::create_child(temp.path(), name).is_err(), "{name}");
        }
        Ok(())
    }

    #[cfg(unix)]
    #[test]
    fn rejects_symlink_escape() -> Result<()> {
        let dir = tempfile::tempdir()?;
        let outside = tempfile::tempdir()?;
        std::os::unix::fs::symlink(outside.path(), dir.path().join("link"))?;
        assert!(Vault::open(dir.path())?
            .note_path("link/secret.md")
            .is_err());
        Ok(())
    }
}
