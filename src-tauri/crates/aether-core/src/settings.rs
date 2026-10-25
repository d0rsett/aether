use crate::files::atomic_write;
use crate::{Error, Result};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::Path;

fn vault_key(path: &str) -> String {
    if cfg!(windows) {
        path.strip_prefix("\\\\?\\")
            .unwrap_or(path)
            .replace('\\', "/")
            .to_lowercase()
    } else {
        path.into()
    }
}

#[derive(Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Settings {
    pub last_vault: Option<String>,
    #[serde(default)]
    pub recent_vaults: Vec<String>,
}

impl Settings {
    pub fn vault_paths(&self) -> Vec<String> {
        let mut result = Vec::new();
        for path in self.last_vault.iter().chain(&self.recent_vaults) {
            if !result
                .iter()
                .any(|saved: &String| vault_key(saved) == vault_key(path))
            {
                result.push(path.clone());
            }
            if result.len() == 20 {
                break;
            }
        }
        result
    }
    pub fn remember(&mut self, path: &str) {
        let mut recent = self.vault_paths();
        recent.retain(|saved| vault_key(saved) != vault_key(path));
        recent.insert(0, path.into());
        recent.truncate(20);
        self.last_vault = Some(path.into());
        self.recent_vaults = recent;
    }
    pub fn load(path: &Path) -> Result<Self> {
        match fs::read(path) {
            Ok(bytes) => serde_json::from_slice(&bytes)
                .map_err(|e| Error::Io(format!("Не удалось прочитать настройки: {e}"))),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(Self::default()),
            Err(e) => Err(e.into()),
        }
    }

    pub fn save(&self, path: &Path) -> Result<()> {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent)?;
        }
        let bytes = serde_json::to_vec_pretty(self).map_err(|e| Error::Io(e.to_string()))?;
        atomic_write(path, &bytes, true)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn last_vault_roundtrips_and_corruption_is_reported() -> Result<()> {
        let dir = tempfile::tempdir()?;
        let path = dir.path().join("settings.json");
        assert!(Settings::load(&path)?.last_vault.is_none());
        Settings {
            last_vault: Some("C:/Заметки".into()),
            ..Settings::default()
        }
        .save(&path)?;
        assert_eq!(
            Settings::load(&path)?.last_vault.as_deref(),
            Some("C:/Заметки")
        );
        fs::write(&path, "invalid")?;
        assert!(Settings::load(&path).is_err());
        Ok(())
    }
    #[test]
    fn legacy_settings_and_recent_vaults_roundtrip_without_duplicates() -> Result<()> {
        let temp = tempfile::tempdir()?;
        let path = temp.path().join("settings.json");
        fs::write(&path, r#"{"lastVault":"C:/Legacy"}"#)?;
        let mut settings = Settings::load(&path)?;
        assert_eq!(settings.vault_paths(), vec!["C:/Legacy"]);
        settings.remember("C:/Новые");
        settings.remember("C:/Legacy");
        settings.save(&path)?;
        assert_eq!(
            Settings::load(&path)?.vault_paths(),
            vec!["C:/Legacy", "C:/Новые"]
        );
        if cfg!(windows) {
            settings.remember("\\\\?\\C:\\LEGACY");
            assert_eq!(settings.vault_paths().len(), 2);
        }
        for i in 0..30 {
            settings.remember(&format!("C:/Vault{i}"));
        }
        assert_eq!(settings.vault_paths().len(), 20);
        Ok(())
    }
}
