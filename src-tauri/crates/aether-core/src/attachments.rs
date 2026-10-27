use crate::{vault::Vault, Error, Result};
use base64::{engine::general_purpose::STANDARD, Engine};
use std::io::Read;

pub fn matches(v: &Vault, target: &str) -> Result<Vec<String>> {
    v.resolve(target, false)?;
    let mut found = Vec::new();
    for entry in walkdir::WalkDir::new(v.root())
        .follow_links(false)
        .into_iter()
        .filter_entry(|entry| {
            entry.depth() == 0
                || (!entry.file_name().to_string_lossy().starts_with('.')
                    && !std::fs::symlink_metadata(entry.path())
                        .is_ok_and(|metadata| crate::vault::is_link(&metadata)))
        })
    {
        let entry = entry.map_err(|error| Error::Io(error.to_string()))?;
        if !entry.file_type().is_file() {
            continue;
        }
        let path = entry
            .path()
            .strip_prefix(v.root())
            .map_err(|error| Error::InvalidPath(error.to_string()))?
            .to_string_lossy()
            .replace('\\', "/");
        if path.eq_ignore_ascii_case(target)
            || path
                .to_lowercase()
                .ends_with(&format!("/{}", target.to_lowercase()))
        {
            found.push(path);
        }
    }
    found.sort();
    Ok(found)
}

pub fn resolve(v: &Vault, source: &str, target: &str, _wiki: bool) -> Result<String> {
    v.note_path(source)?;
    let raw = target.split('#').next().unwrap_or(target);
    let root = crate::navigation::decode(raw);
    if let Some(path) = root.strip_prefix('/') {
        if !path.starts_with('/') && v.resolve(path, false)?.is_file() {
            return Ok(path.into());
        }
        return Err(Error::InvalidPath(
            "Вложение не найдено внутри хранилища.".into(),
        ));
    }
    let local = relative_target(source, raw)?;
    if v.resolve(&local, false)?.is_file() {
        return Ok(local);
    }
    if !root.starts_with("../") && !root.starts_with("./") {
        if v.resolve(&root, false)?.is_file() {
            return Ok(root);
        }
        let found = matches(v, &root)?;
        if found.len() == 1 {
            return Ok(found[0].clone());
        }
        if found.len() > 1 {
            return Err(Error::InvalidPath(
                "Несколько вложений с таким именем. Укажите путь к файлу.".into(),
            ));
        }
    }
    Err(Error::Io("Вложение не найдено.".into()))
}

pub fn image_mime(bytes: &[u8]) -> Result<&'static str> {
    if bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        return Ok("image/png");
    }
    if bytes.starts_with(b"\xff\xd8\xff") {
        return Ok("image/jpeg");
    }
    if bytes.starts_with(b"GIF87a") || bytes.starts_with(b"GIF89a") {
        return Ok("image/gif");
    }
    if bytes.starts_with(b"RIFF") && bytes.get(8..12) == Some(b"WEBP") {
        return Ok("image/webp");
    }
    if bytes.starts_with(b"BM") {
        return Ok("image/bmp");
    }
    // SVG is loaded only as an image, never as HTML. Restrict it to self-contained,
    // passive markup; scriptable SVG and references remain unsupported.
    if let Ok(text) = std::str::from_utf8(bytes) {
        let lower = text.to_ascii_lowercase();
        if lower.contains("<svg")
            && ![
                "<!doctype",
                "<!entity",
                "<script",
                "<foreignobject",
                "href",
                "url(",
                "@import",
                "<?xml-stylesheet",
                " on",
                "\ton",
                "\non",
                "\ron",
            ]
            .iter()
            .any(|pattern| lower.contains(pattern))
        {
            return Ok("image/svg+xml");
        }
    }
    Err(Error::Io(
        "Поддерживаются PNG, JPEG, GIF, WebP, BMP и SVG без активного содержимого.".into(),
    ))
}

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
    let path = v.resolve(&resolve(v, source, target, wiki)?, false)?;
    let file = std::fs::File::open(path)?;
    if file.metadata()?.len() > 8 * 1024 * 1024 {
        return Err(Error::Io("Изображение превышает 8 МБ.".into()));
    }
    let mut bytes = Vec::new();
    file.take(8 * 1024 * 1024 + 1).read_to_end(&mut bytes)?;
    if bytes.len() > 8 * 1024 * 1024 {
        return Err(Error::Io("Изображение превышает 8 МБ.".into()));
    }
    let mime = image_mime(&bytes)?;
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
