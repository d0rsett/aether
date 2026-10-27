pub mod attachment_import;
pub mod attachments;
pub mod files;
pub mod indexing;
pub mod links;
pub mod markdown;
pub mod navigation;
pub mod renaming;
pub mod rendering;
pub mod settings;
pub mod vault;
pub mod watching;

use serde::Serialize;

#[derive(Debug, thiserror::Error, Serialize)]
#[serde(tag = "code", content = "message")]
pub enum Error {
    #[error("{0}")]
    Io(String),
    #[error("{0}")]
    InvalidPath(String),
    #[error("Файл изменён другим приложением. Сохраните копию или перечитайте файл.")]
    Conflict,
    #[error("Файл или папка с таким именем уже существует.")]
    AlreadyExists,
    #[error("Хранилище больше не активно.")]
    NoVault,
    #[error("{0}")]
    Index(String),
    #[error("{0}")]
    Navigation(String),
    #[error("{0}")]
    Transaction(String),
    #[error("{0}")]
    Recovery(String),
}

impl From<std::io::Error> for Error {
    fn from(error: std::io::Error) -> Self {
        Self::Io(error.to_string())
    }
}

pub type Result<T> = std::result::Result<T, Error>;

impl From<rusqlite::Error> for Error {
    fn from(error: rusqlite::Error) -> Self {
        Self::Index(error.to_string())
    }
}
