use crate::{attachments, files, vault::Vault, Error, Result};
use base64::{engine::general_purpose::STANDARD, Engine};
use serde::{Deserialize, Serialize};
use std::{fs, io::Read};

pub const MAX_FILE_BYTES: usize = 25 * 1024 * 1024;
const MAX_TOTAL_BYTES: usize = 50 * 1024 * 1024;

#[derive(Deserialize)]
pub struct Upload {
    pub name: String,
    pub data: String,
}
#[derive(Serialize)]
pub struct Imported {
    pub path: String,
    pub link: String,
}

fn settings(vault: &Vault) -> Result<serde_json::Value> {
    let path = vault.resolve(".obsidian/app.json", false)?;
    let file = match fs::File::open(path) {
        Ok(file) => file,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return Ok(serde_json::Value::Null)
        }
        Err(error) => return Err(error.into()),
    };
    let mut bytes = Vec::new();
    file.take(128 * 1024 + 1).read_to_end(&mut bytes)?;
    if bytes.len() > 128 * 1024 {
        return Err(Error::Io("Настройки Obsidian слишком велики.".into()));
    }
    let text = std::str::from_utf8(&bytes)
        .map_err(|_| Error::Io("Не удалось прочитать настройки Obsidian.".into()))?;
    serde_json::from_str(text.trim_start_matches('\u{feff}'))
        .map_err(|error| Error::Io(format!("Не удалось прочитать .obsidian/app.json: {error}")))
}

fn folder(source: &str, config: &serde_json::Value) -> Result<String> {
    let configured = config
        .get("attachmentFolderPath")
        .and_then(|value| value.as_str())
        .unwrap_or("/");
    let parent = source.rsplit_once('/').map_or("", |(parent, _)| parent);
    let result = match configured {
        "" | "/" => String::new(),
        "." | "./" => parent.into(),
        path if path.starts_with("./") => {
            [parent, path.trim_start_matches("./").trim_end_matches('/')]
                .into_iter()
                .filter(|part| !part.is_empty())
                .collect::<Vec<_>>()
                .join("/")
        }
        path => path.trim_end_matches('/').to_owned(),
    };
    if result
        .split('/')
        .any(|part| matches!(part, ".obsidian" | ".git" | ".aether") || part == "..")
    {
        return Err(Error::InvalidPath(
            "Недопустимая папка вложений в настройках Obsidian.".into(),
        ));
    }
    Ok(result)
}

fn ensure_folder(vault: &Vault, folder: &str) -> Result<()> {
    vault.resolve(folder, true)?;
    let mut current = String::new();
    for part in folder.split('/').filter(|part| !part.is_empty()) {
        if !current.is_empty() {
            current.push('/');
        }
        current.push_str(part);
        let path = vault.resolve(&current, false)?;
        match fs::create_dir(&path) {
            Ok(()) => {}
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists && path.is_dir() => {}
            Err(error) => return Err(error.into()),
        }
    }
    Ok(())
}

fn filename(raw: &str) -> Result<String> {
    if raw.contains(['/', '\\']) {
        return Err(Error::InvalidPath(
            "Ожидается имя вложения без пути.".into(),
        ));
    }
    let name: String = raw
        .chars()
        .map(|ch| {
            if ch.is_control() || "<>:\"|?*[]#^".contains(ch) {
                '_'
            } else {
                ch
            }
        })
        .collect();
    let mut name = name.trim().trim_matches('.').to_owned();
    let stem = name.split('.').next().unwrap_or_default().to_uppercase();
    if matches!(stem.as_str(), "CON" | "PRN" | "AUX" | "NUL")
        || ((stem.starts_with("COM") || stem.starts_with("LPT")) && stem.len() == 4)
    {
        name.insert(0, '_');
    }
    if name.is_empty() || name.len() > 220 {
        return Err(Error::InvalidPath("Недопустимое имя вложения.".into()));
    }
    Ok(name)
}

fn relative(source: &str, target: &str) -> String {
    let parent: Vec<_> = source
        .rsplit_once('/')
        .map_or("", |(parent, _)| parent)
        .split('/')
        .filter(|part| !part.is_empty())
        .collect();
    let dest: Vec<_> = target.split('/').collect();
    let shared = parent.iter().zip(&dest).take_while(|(a, b)| a == b).count();
    let mut result = vec![".."; parent.len() - shared];
    result.extend_from_slice(&dest[shared..]);
    result.join("/")
}

fn encoded(path: &str) -> String {
    path.bytes()
        .map(|byte| {
            if byte.is_ascii_alphanumeric() || b"-._~/".contains(&byte) {
                (byte as char).to_string()
            } else {
                format!("%{byte:02X}")
            }
        })
        .collect()
}

pub fn import(vault: &Vault, source: &str, uploads: Vec<Upload>) -> Result<Vec<Imported>> {
    import_with_options(vault, source, uploads, false)
}

pub fn import_with_options(
    vault: &Vault,
    source: &str,
    uploads: Vec<Upload>,
    root_images: bool,
) -> Result<Vec<Imported>> {
    if !vault.note_path(source)?.is_file() {
        return Err(Error::InvalidPath(
            "Заметка для вставки вложений не найдена.".into(),
        ));
    }
    if uploads.is_empty() || uploads.len() > 20 {
        return Err(Error::Io("За один раз можно вставить до 20 файлов.".into()));
    }
    let config = settings(vault)?;
    let folder = folder(source, &config)?;
    vault.resolve(&folder, true)?;
    let mut total = 0;
    let mut decoded = Vec::new();
    for upload in uploads {
        let name = filename(&upload.name)?;
        let extension = name.rsplit('.').next().unwrap_or("").to_ascii_lowercase();
        if ![
            "png", "jpg", "jpeg", "gif", "webp", "bmp", "svg", "pdf", "mp3", "wav", "ogg", "m4a",
            "flac", "3gp", "mp4", "webm", "mov", "mkv", "ogv", "md", "canvas", "txt", "csv",
            "docx", "xlsx", "pptx", "zip",
        ]
        .contains(&extension.as_str())
        {
            return Err(Error::Io(format!("Неподдерживаемый тип вложения: {name}")));
        }
        if upload.data.len() > MAX_FILE_BYTES.div_ceil(3) * 4 {
            return Err(Error::Io("Вложение превышает 25 МБ.".into()));
        }
        let bytes = STANDARD
            .decode(&upload.data)
            .map_err(|_| Error::Io("Повреждены данные вложения.".into()))?;
        if bytes.len() > MAX_FILE_BYTES {
            return Err(Error::Io("Вложение превышает 25 МБ.".into()));
        }
        total += bytes.len();
        if total > MAX_TOTAL_BYTES {
            return Err(Error::Io("Общий размер вложений превышает 50 МБ.".into()));
        }
        if ["png", "jpg", "jpeg", "gif", "webp", "bmp", "svg"].contains(&extension.as_str()) {
            if bytes.len() > 8 * 1024 * 1024 {
                return Err(Error::Io("Изображение превышает 8 МБ.".into()));
            }
            attachments::image_mime(&bytes)?;
        }
        let destination = if root_images && crate::vault::is_image(std::path::Path::new(&name)) {
            String::new()
        } else {
            folder.clone()
        };
        decoded.push((name, bytes, destination));
    }
    for (_, _, destination) in &decoded {
        ensure_folder(vault, destination)?;
    }
    let mut created: Vec<(String, String)> = Vec::new();
    let result = (|| {
        let mut paths = Vec::new();
        for (name, bytes, folder) in decoded {
            let (stem, extension) = name.rsplit_once('.').unwrap_or((&name, ""));
            let mut chosen = None;
            for number in 0..10000 {
                let candidate = if number == 0 {
                    name.clone()
                } else {
                    format!("{stem} {number}.{extension}")
                };
                let path = if folder.is_empty() {
                    candidate
                } else {
                    format!("{folder}/{candidate}")
                };
                let absolute = vault.resolve(&path, false)?;
                if absolute.exists() {
                    continue;
                }
                match files::atomic_write(&absolute, &bytes, false) {
                    Ok(()) => {
                        created.push((path.clone(), files::revision(&bytes)));
                        chosen = Some(path);
                        break;
                    }
                    Err(Error::AlreadyExists) => continue,
                    Err(error) => return Err(error),
                }
            }
            paths.push(
                chosen.ok_or_else(|| Error::Io("Не удалось подобрать имя вложения.".into()))?,
            );
        }
        paths
            .into_iter()
            .map(|path| link_for(vault, source, path, &config))
            .collect()
    })();
    if result.is_err() {
        for (path, revision) in created {
            if let Ok(absolute) = vault.resolve(&path, false) {
                if fs::read(&absolute).is_ok_and(|bytes| files::revision(&bytes) == revision) {
                    let _ = fs::remove_file(absolute);
                }
            }
        }
    }
    result
}

fn link_for(
    vault: &Vault,
    source: &str,
    path: String,
    config: &serde_json::Value,
) -> Result<Imported> {
    let markdown = config
        .get("useMarkdownLinks")
        .and_then(|value| value.as_bool())
        .unwrap_or(false);
    let format = config
        .get("newLinkFormat")
        .and_then(|value| value.as_str())
        .unwrap_or("shortest");
    let target = match format {
        "relative" => relative(source, &path),
        "absolute" => path.clone(),
        _ => {
            let name = path.rsplit('/').next().unwrap_or(&path);
            if attachments::matches(vault, name)?.len() == 1 {
                name.to_owned()
            } else {
                path.clone()
            }
        }
    };
    let link = if markdown {
        format!("![]({})", encoded(&target))
    } else {
        format!("![[{target}]]")
    };
    Ok(Imported { path, link })
}

pub fn existing(vault: &Vault, source: &str, paths: Vec<String>) -> Result<Vec<Imported>> {
    vault.note_path(source)?;
    if paths.is_empty() || paths.len() > 20 {
        return Err(Error::Io(
            "За один раз можно вставить до 20 изображений.".into(),
        ));
    }
    let config = settings(vault)?;
    paths
        .into_iter()
        .map(|path| {
            let absolute = vault.resolve(&path, false)?;
            if !absolute.is_file() || !crate::vault::is_image(&absolute) {
                return Err(Error::InvalidPath(
                    "Изображение не найдено в хранилище.".into(),
                ));
            }
            link_for(vault, source, path, &config)
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    const PNG: &[u8] = b"\x89PNG\r\n\x1a\nattachment-test";
    fn fixture(config: serde_json::Value) -> Result<(tempfile::TempDir, Vault)> {
        let temp = tempfile::tempdir()?;
        fs::create_dir(temp.path().join("Notes"))?;
        fs::create_dir(temp.path().join(".obsidian"))?;
        fs::write(temp.path().join("Notes/Note.md"), "original")?;
        fs::write(
            temp.path().join(".obsidian/app.json"),
            serde_json::to_vec(&config).unwrap(),
        )?;
        let vault = Vault::open(temp.path())?;
        Ok((temp, vault))
    }
    fn upload(name: &str) -> Upload {
        Upload {
            name: name.into(),
            data: STANDARD.encode(PNG),
        }
    }

    #[test]
    fn clipboard_images_use_root_and_existing_images_link_without_copying() -> Result<()> {
        let (temp, vault) = fixture(serde_json::json!({
            "attachmentFolderPath": "Notes/assets",
            "useMarkdownLinks": true,
            "newLinkFormat": "relative"
        }))?;
        let first = import_with_options(
            &vault,
            "Notes/Note.md",
            vec![upload("Новое изображение.png")],
            true,
        )?;
        let second = import_with_options(
            &vault,
            "Notes/Note.md",
            vec![upload("Новое изображение.png")],
            true,
        )?;
        assert_eq!(first[0].path, "Новое изображение.png");
        assert_eq!(second[0].path, "Новое изображение 1.png");
        assert!(!temp.path().join("Notes/assets").exists());
        let before = fs::read(temp.path().join("Новое изображение.png"))?;
        let linked = existing(&vault, "Notes/Note.md", vec![first[0].path.clone()])?;
        assert_eq!(linked[0].link, first[0].link);
        assert!(linked[0].link.starts_with("![](../%D0"));
        assert_eq!(fs::read(temp.path().join("Новое изображение.png"))?, before);
        assert!(existing(&vault, "Notes/Note.md", vec!["../escape.png".into()]).is_err());
        assert!(existing(&vault, "Notes/Note.md", vec!["Notes/Note.md".into()]).is_err());
        assert!(existing(&vault, "Notes/Note.md", vec!["missing.png".into()]).is_err());
        assert_eq!(vault.read_note("Notes/Note.md")?.content, "original");
        Ok(())
    }

    #[test]
    fn honors_all_obsidian_attachment_folders_without_changing_config_or_note() -> Result<()> {
        for (folder, expected) in [
            ("/", "photo.png"),
            (".", "Notes/photo.png"),
            ("Media/Images", "Media/Images/photo.png"),
            ("./assets", "Notes/assets/photo.png"),
        ] {
            let config = serde_json::json!({"attachmentFolderPath":folder, "newLinkFormat":"absolute", "unrelated":{"keep":true}});
            let (temp, vault) = fixture(config.clone())?;
            let imported = import(&vault, "Notes/Note.md", vec![upload("photo.png")])?;
            assert_eq!(imported[0].path, expected);
            assert_eq!(imported[0].link, format!("![[{expected}]]"));
            assert_eq!(fs::read(temp.path().join(expected))?, PNG);
            assert_eq!(
                fs::read_to_string(temp.path().join("Notes/Note.md"))?,
                "original"
            );
            assert_eq!(
                serde_json::from_slice::<serde_json::Value>(&fs::read(
                    temp.path().join(".obsidian/app.json")
                )?)
                .unwrap(),
                config
            );
        }
        Ok(())
    }
    #[test]
    fn unique_names_short_links_and_markdown_relative_paths_round_trip() -> Result<()> {
        let (temp, vault) = fixture(serde_json::json!({"attachmentFolderPath":"Media"}))?;
        let first = import(
            &vault,
            "Notes/Note.md",
            vec![upload("a b.png"), upload("a b.png")],
        )?;
        assert_eq!(first[0].link, "![[a b.png]]");
        assert_eq!(first[1].path, "Media/a b 1.png");
        assert_eq!(
            attachments::resolve(&vault, "Notes/Note.md", "a b.png", true)?,
            first[0].path
        );
        assert!(
            attachments::image(&vault, "Notes/Note.md", "a b.png", true)?
                .starts_with("data:image/png")
        );
        fs::write(
            temp.path().join(".obsidian/app.json"),
            r#"{"attachmentFolderPath":"./assets","useMarkdownLinks":true,"newLinkFormat":"relative"}"#,
        )?;
        let markdown = import(&vault, "Notes/Note.md", vec![upload("ещё фото.png")])?;
        assert!(markdown[0].link.starts_with("![](assets/"));
        assert!(markdown[0].link.contains("%20"));
        assert_eq!(
            attachments::resolve(
                &vault,
                "Notes/Note.md",
                markdown[0]
                    .link
                    .trim_start_matches("![](")
                    .trim_end_matches(')'),
                false
            )?,
            markdown[0].path
        );
        Ok(())
    }
    #[test]
    fn rejects_escapes_and_validates_entire_batch_before_writing() -> Result<()> {
        let (temp, vault) = fixture(serde_json::json!({"attachmentFolderPath":"../outside"}))?;
        assert!(import(&vault, "Notes/Note.md", vec![upload("pic.png")]).is_err());
        fs::write(temp.path().join(".obsidian/app.json"), "{}")?;
        assert!(import(
            &vault,
            "Notes/Note.md",
            vec![upload("ok.png"), upload("../bad.png")]
        )
        .is_err());
        assert!(!temp.path().join("ok.png").exists());
        assert!(import(&vault, "Notes/Note.md", vec![upload("program.exe")]).is_err());
        assert!(import(&vault, "Missing.md", vec![upload("pic.png")]).is_err());
        Ok(())
    }
    #[test]
    fn duplicate_short_names_require_a_path_and_passive_svg_is_supported() -> Result<()> {
        let (temp, vault) = fixture(serde_json::json!({}))?;
        fs::create_dir(temp.path().join("A"))?;
        fs::create_dir(temp.path().join("B"))?;
        fs::write(temp.path().join("A/pic.png"), PNG)?;
        fs::write(temp.path().join("B/pic.png"), PNG)?;
        assert!(attachments::resolve(&vault, "Notes/Note.md", "pic.png", true).is_err());
        assert_eq!(
            attachments::resolve(&vault, "Notes/Note.md", "A/pic.png", true)?,
            "A/pic.png"
        );
        assert_eq!(
            attachments::image_mime(
                br#"<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0h10v10z"/></svg>"#
            )?,
            "image/svg+xml"
        );
        assert!(attachments::image_mime(br#"<svg onload="alert(1)"/>"#).is_err());
        assert!(
            attachments::image_mime(br#"<svg><image href="https://example.org"/></svg>"#).is_err()
        );
        Ok(())
    }
}
