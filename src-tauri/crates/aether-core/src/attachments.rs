use crate::{vault::Vault, Error, Result};
use base64::{engine::general_purpose::STANDARD, Engine};
use std::io::Read;

pub fn relative_target(source: &str, target: &str) -> Result<String> {
    let target = crate::navigation::decode(target);
    if target.contains(['\\', ':']) || target.starts_with('/') {
        return Err(Error::InvalidPath(
            "Ожидается путь к файлу внутри хранилища.".into(),
        ));
    }
    let mut parts: Vec<&str> = source
        .rsplit_once('/')
        .map_or("", |(parent, _)| parent)
        .split('/')
        .filter(|s| !s.is_empty())
        .collect();
    for part in target.split('/') {
        match part {
            "" | "." => {}
            ".." => {
                parts.pop().ok_or_else(|| {
                    Error::InvalidPath("Путь выходит за пределы хранилища.".into())
                })?;
            }
            value => parts.push(value),
        }
    }
    Ok(parts.join("/"))
}
pub fn image(v: &Vault, source: &str, target: &str, wiki: bool) -> Result<String> {
    v.note_path(source)?;
    let raw = target.split('#').next().unwrap_or(target);
    let local = relative_target(source, raw)?;
    let root = crate::navigation::decode(raw);
    let path = if wiki
        && !root.starts_with("../")
        && !root.starts_with("./")
        && v.resolve(&root, false)?.is_file()
    {
        v.resolve(&root, false)?
    } else {
        v.resolve(&local, false)?
    };
    let file = std::fs::File::open(path)?;
    if file.metadata()?.len() > 8 * 1024 * 1024 {
        return Err(Error::Io("Изображение превышает 8 МБ.".into()));
    }
    let mut bytes = Vec::new();
    file.take(8 * 1024 * 1024 + 1).read_to_end(&mut bytes)?;
    if bytes.len() > 8 * 1024 * 1024 {
        return Err(Error::Io("Изображение превышает 8 МБ.".into()));
    }
    let mime = if bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        "image/png"
    } else if bytes.starts_with(b"\xff\xd8\xff") {
        "image/jpeg"
    } else if bytes.starts_with(b"GIF87a") || bytes.starts_with(b"GIF89a") {
        "image/gif"
    } else if bytes.starts_with(b"RIFF") && bytes.get(8..12) == Some(b"WEBP") {
        "image/webp"
    } else {
        return Err(Error::Io(
            "Поддерживаются локальные PNG, JPEG, GIF и WebP.".into(),
        ));
    };
    Ok(format!("data:{mime};base64,{}", STANDARD.encode(bytes)))
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn scoped_attachments_reject_escapes_active_formats_and_urls() -> Result<()> {
        let temp = tempfile::tempdir()?;
        let v = Vault::open(temp.path())?;
        v.create_directory("Notes")?;
        std::fs::write(temp.path().join("pic.png"), b"\x89PNG\r\n\x1a\nbytes")?;
        assert!(
            image(&v, "Notes/Note.md", "../pic.png", false)?.starts_with("data:image/png;base64,")
        );
        assert!(image(&v, "Notes/Note.md", "pic.png", true).is_ok());
        assert!(image(&v, "Notes/Note.md", "../pic.png", true).is_ok());
        for target in [
            "../../secret.png",
            "https://example.com/x.png",
            ".aether/key",
            "C:/secret.png",
        ] {
            assert!(image(&v, "Note.md", target, false).is_err());
        }
        std::fs::write(temp.path().join("active.svg"), b"<svg onload='alert(1)'/>")?;
        assert!(image(&v, "Note.md", "active.svg", false).is_err());
        Ok(())
    }
}
