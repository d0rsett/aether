use crate::files::{atomic_write, atomic_write_checked, revision, Note};
use crate::vault::{is_canvas, Vault};
use crate::{Error, Result};
use std::io::Read;
use std::path::{Path, PathBuf};

const LIMIT: usize = 8 * 1024 * 1024;

fn read_bytes(path: &Path) -> Result<Vec<u8>> {
    let mut bytes = Vec::new();
    std::fs::File::open(path)?
        .take(LIMIT as u64 + 1)
        .read_to_end(&mut bytes)?;
    if bytes.len() > LIMIT {
        return Err(Error::Io("Файл доски слишком большой.".into()));
    }
    Ok(bytes)
}

fn validate(content: &str) -> Result<()> {
    if content.len() > LIMIT {
        return Err(Error::Io("Файл доски слишком большой.".into()));
    }
    let parsed: serde_json::Value = serde_json::from_str(content.trim_start_matches('\u{feff}'))
        .map_err(|_| Error::Io("Некорректный файл доски.".into()))?;
    if !parsed.is_object()
        || ["nodes", "edges"]
            .iter()
            .any(|key| parsed.get(key).is_some_and(|value| !value.is_array()))
    {
        return Err(Error::Io("Некорректный файл доски.".into()));
    }
    Ok(())
}

impl Vault {
    fn canvas_path(&self, relative: &str) -> Result<PathBuf> {
        let path = self.resolve(relative, false)?;
        if !is_canvas(&path) {
            return Err(Error::InvalidPath("Укажите файл .canvas.".into()));
        }
        Ok(path)
    }

    pub fn read_canvas(&self, relative: &str) -> Result<Note> {
        let bytes = read_bytes(&self.canvas_path(relative)?)?;
        let revision = revision(&bytes);
        let content = String::from_utf8(bytes)
            .map_err(|_| Error::Io("Файл доски не является UTF-8.".into()))?;
        Ok(Note {
            path: relative.into(),
            content,
            revision,
        })
    }

    pub fn create_canvas(&self, relative: &str, content: &str) -> Result<Note> {
        let path = self.canvas_path(relative)?;
        validate(content)?;
        atomic_write(&path, content.as_bytes(), false)?;
        self.read_canvas(relative)
    }

    pub fn trash_canvas(&self, relative: &str, expected: &str) -> Result<String> {
        self.trash_file(&self.canvas_path(relative)?, expected, ".canvas")
    }

    pub fn save_canvas(&self, relative: &str, content: &str, expected: &str) -> Result<String> {
        let path = self.canvas_path(relative)?;
        validate(content)?;
        if revision(&read_bytes(&path)?) != expected {
            return Err(Error::Conflict);
        }
        atomic_write_checked(&path, content.as_bytes(), true, Some(expected))?;
        Ok(revision(content.as_bytes()))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn trashes_canvas_as_a_recoverable_canvas_and_checks_revisions() -> Result<()> {
        let root = tempfile::tempdir()?;
        let vault = Vault::open(root.path())?;
        let initial = r#"{"nodes":[]}"#;
        let board = vault.create_canvas("Board.canvas", initial)?;
        let source = root.path().join("Board.canvas");
        let updated = r#"{"nodes":[],"external":true}"#;
        std::fs::write(&source, updated)?;
        assert!(matches!(
            vault.trash_canvas("Board.canvas", &board.revision),
            Err(Error::Conflict)
        ));
        let current = vault.read_canvas("Board.canvas")?;
        let trash = PathBuf::from(vault.trash_canvas("Board.canvas", &current.revision)?);
        assert!(trash.starts_with(vault.root().join(".aether/trash")));
        assert_eq!(
            trash.extension().and_then(|ext| ext.to_str()),
            Some("canvas")
        );
        assert_eq!(std::fs::read_to_string(trash)?, updated);
        assert!(!source.exists());
        Ok(())
    }

    #[test]
    fn creates_canvas_exclusively() -> Result<()> {
        let root = tempfile::tempdir()?;
        let vault = Vault::open(root.path())?;
        let empty = r#"{"nodes":[],"edges":[]}"#;
        let created = vault.create_canvas("Board.canvas", empty)?;
        assert_eq!(created.content, empty);
        assert!(matches!(
            vault.create_canvas("Board.canvas", "{}"),
            Err(Error::AlreadyExists)
        ));
        assert!(vault.create_canvas("../outside.canvas", empty).is_err());
        assert!(vault.create_canvas("wrong.md", empty).is_err());
        assert_eq!(vault.read_canvas("Board.canvas")?.content, empty);
        Ok(())
    }

    #[test]
    fn saves_canvas_without_rewriting_extensions_or_overwriting_external_changes() -> Result<()> {
        let root = tempfile::tempdir()?;
        let path = root.path().join("Board.canvas");
        std::fs::write(&path, br#"{"nodes":[],"edges":[]}"#)?;
        let vault = Vault::open(root.path())?;
        let original = vault.read_canvas("Board.canvas")?;
        let moved = r#"{"nodes":[{"id":"a","type":"text","x":20,"y":-10,"width":160,"height":80,"text":"Note","extension":{"enabled":true}}],"edges":[]}"#;
        let saved = vault.save_canvas("Board.canvas", moved, &original.revision)?;
        assert_eq!(vault.read_canvas("Board.canvas")?.content, moved);
        assert!(vault.read_canvas("../Board.canvas").is_err());
        assert!(vault.read_note("Board.canvas").is_err());
        assert!(vault.save_canvas("Board.canvas", "[]", &saved).is_err());
        std::fs::write(&path, br#"{"nodes":[],"external":true}"#)?;
        assert!(matches!(
            vault.save_canvas("Board.canvas", moved, &saved),
            Err(Error::Conflict)
        ));
        assert_eq!(
            vault.read_canvas("Board.canvas")?.content,
            r#"{"nodes":[],"external":true}"#
        );
        Ok(())
    }
}
