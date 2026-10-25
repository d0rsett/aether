//! Revision-checked rename plans and durable, explicit recovery. Markdown remains authoritative.
use crate::files::{atomic_write, revision, Note};
use crate::vault::{is_link, Vault};
use crate::{links, markdown, Error, Result};
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use std::{
    collections::BTreeMap,
    fs,
    path::PathBuf,
    sync::atomic::{AtomicU64, Ordering},
};

static NEXT: AtomicU64 = AtomicU64::new(1);
fn failure(message: impl Into<String>) -> Error {
    Error::Recovery(message.into())
}
fn json<T: Serialize>(value: &T) -> Result<Vec<u8>> {
    serde_json::to_vec(value).map_err(|e| failure(e.to_string()))
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Change {
    pub path: String,
    pub line: usize,
    pub before: String,
    pub after: String,
}
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Preview {
    pub token: String,
    pub from: String,
    pub to: String,
    pub files: usize,
    pub links: usize,
    pub unresolved: usize,
    pub changes: Vec<Change>,
    pub has_more: bool,
    pub affected_open_paths: Vec<String>,
}
pub struct Plan {
    manifest: Manifest,
    contents: Vec<(String, String)>,
    stamps: BTreeMap<String, String>,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct File {
    path: String,
    after_path: String,
    before: String,
    after: String,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Manifest {
    version: u8,
    id: String,
    from: String,
    to: String,
    state: String,
    previous: Option<String>,
    files: Vec<File>,
    #[serde(skip)]
    changes: Vec<Change>,
    unresolved: usize,
    #[serde(default)]
    directory: bool,
    #[serde(default)]
    tree: BTreeMap<String, String>,
}
#[derive(Default, Serialize, Deserialize)]
struct Pointer {
    id: Option<String>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RenameState {
    pub id: String,
    pub from: String,
    pub to: String,
    pub pending: bool,
    pub affected_open_paths: Vec<String>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Applied {
    pub from: String,
    pub note: Note,
    pub directory: bool,
    #[serde(skip)]
    pub changed_paths: Vec<String>,
}

fn remap(path: &str, from: &str, to: &str, directory: bool) -> String {
    if path == from {
        to.into()
    } else if directory {
        path.strip_prefix(&format!("{from}/"))
            .map_or_else(|| path.into(), |rest| format!("{to}/{rest}"))
    } else {
        path.into()
    }
}

fn inventory(v: &Vault, folder: &str) -> Result<BTreeMap<String, String>> {
    use sha2::{Digest, Sha256};
    use std::io::Read;
    let root = v.resolve(folder, false)?;
    if !root.is_dir() {
        return Err(Error::InvalidPath("Ожидается папка.".into()));
    }
    let mut result = BTreeMap::new();
    for entry in walkdir::WalkDir::new(&root).follow_links(false) {
        let entry = entry.map_err(|e| Error::Io(e.to_string()))?;
        let metadata = fs::symlink_metadata(entry.path())?;
        if is_link(&metadata) {
            return Err(Error::InvalidPath(
                "Папка содержит символическую ссылку/reparse point.".into(),
            ));
        }
        let relative = entry
            .path()
            .strip_prefix(&root)
            .map_err(|e| Error::InvalidPath(e.to_string()))?
            .to_string_lossy()
            .replace('\\', "/");
        v.resolve(
            &format!(
                "{folder}{}{relative}",
                if relative.is_empty() { "" } else { "/" }
            ),
            false,
        )?;
        let value = if metadata.is_dir() {
            "dir".into()
        } else {
            let mut file = fs::File::open(entry.path())?;
            let mut hash = Sha256::new();
            let mut buffer = [0u8; 65536];
            loop {
                let count = file.read(&mut buffer)?;
                if count == 0 {
                    break;
                }
                hash.update(&buffer[..count]);
            }
            format!("{:x}", hash.finalize())
        };
        result.insert(relative, value);
    }
    Ok(result)
}

fn move_directory(v: &Vault, from: &str, to: &str) -> Result<()> {
    let source = v.resolve(from, false)?;
    let target = v.resolve(to, false)?;
    if target.exists() {
        return Err(Error::AlreadyExists);
    }
    if !source.is_dir() || target.starts_with(&source) {
        return Err(Error::InvalidPath("Недопустимый путь папки.".into()));
    }
    move_directory_absolute(&source, &target)
}

fn move_directory_absolute(source: &std::path::Path, target: &std::path::Path) -> Result<()> {
    if target.exists() {
        return Err(Error::AlreadyExists);
    }
    #[cfg(windows)]
    fs::rename(source, target)?;
    #[cfg(not(windows))]
    {
        fs::create_dir(&target)?;
        if let Err(error) = fs::rename(source, &target) {
            let _ = fs::remove_dir(target);
            return Err(error.into());
        }
    }
    Ok(())
}

#[derive(Serialize)]
pub struct FolderTrash {
    pub trash: String,
    #[serde(skip)]
    pub changed_paths: Vec<String>,
}

pub fn trash_directory(v: &Vault, path: &str) -> Result<FolderTrash> {
    if state(v, &[])?.is_some_and(|state| state.pending) {
        return Err(failure(
            "Сначала восстановите незавершённое переименование.",
        ));
    }
    let source = v.resolve(path, false)?;
    if !source.is_dir() {
        return Err(Error::InvalidPath("Ожидается папка.".into()));
    }
    let mut changed_paths = Vec::new();
    for entry in walkdir::WalkDir::new(&source).follow_links(false) {
        let entry = entry.map_err(|error| Error::Io(error.to_string()))?;
        if entry.file_type().is_file() {
            let path = entry
                .path()
                .strip_prefix(v.root())
                .map_err(|error| Error::InvalidPath(error.to_string()))?
                .to_string_lossy()
                .replace('\\', "/");
            if path.to_lowercase().ends_with(".md") || path.to_lowercase().ends_with(".markdown") {
                changed_paths.push(path);
            }
        }
    }
    let trash = private(v, true)?.join("trash");
    if !trash.exists() {
        fs::create_dir(&trash)?;
    }
    safe(&trash)?;
    let holder = tempfile::Builder::new()
        .prefix("folder-")
        .tempdir_in(trash)?
        .keep();
    let target = holder.join(
        source
            .file_name()
            .ok_or_else(|| Error::InvalidPath("Нельзя удалить корень хранилища.".into()))?,
    );
    if let Err(error) = move_directory_absolute(&source, &target) {
        let _ = fs::remove_dir(holder);
        return Err(error);
    }
    Ok(FolderTrash {
        trash: target.to_string_lossy().into_owned(),
        changed_paths,
    })
}

fn catalog(vault: &Vault) -> Result<BTreeMap<String, String>> {
    let mut result = BTreeMap::new();
    for entry in walkdir::WalkDir::new(vault.root())
        .follow_links(false)
        .into_iter()
        .filter_entry(|entry| {
            entry.depth() == 0
                || (entry.file_name() != ".aether"
                    && entry.metadata().map_or(true, |m| !is_link(&m)))
        })
    {
        let entry = entry.map_err(|e| Error::Io(e.to_string()))?;
        if !entry.file_type().is_file() {
            continue;
        }
        let path = entry
            .path()
            .strip_prefix(vault.root())
            .map_err(|e| Error::Io(e.to_string()))?
            .to_string_lossy()
            .replace('\\', "/");
        if path.to_lowercase().ends_with(".md") || path.to_lowercase().ends_with(".markdown") {
            result.insert(path.clone(), vault.read_note(&path)?.content);
        }
    }
    Ok(result)
}
fn database(paths: impl Iterator<Item = String>) -> Result<Connection> {
    let db = Connection::open_in_memory()?;
    db.execute_batch("CREATE TABLE notes(path TEXT,path_key TEXT,stem_key TEXT); CREATE INDEX pk ON notes(path_key); CREATE INDEX sk ON notes(stem_key);")?;
    for path in paths {
        db.execute(
            "INSERT INTO notes VALUES(?1,?2,?3)",
            params![path, links::key(&path), links::stem(&path)],
        )?;
    }
    Ok(db)
}
fn canonical(v: &Vault, path: &str) -> Result<String> {
    Ok(v.note_path(path)?
        .strip_prefix(v.root())
        .map_err(|e| Error::InvalidPath(e.to_string()))?
        .to_string_lossy()
        .replace('\\', "/"))
}
fn affected(m: &Manifest, open: &[String]) -> Vec<String> {
    open.iter()
        .filter(|path| {
            m.files.iter().any(|f| {
                f.path.to_lowercase() == path.to_lowercase()
                    || f.after_path.to_lowercase() == path.to_lowercase()
            })
        })
        .cloned()
        .collect()
}

// Source offsets come from pulldown-cmark; only destinations are replaced, never labels/titles.
fn destination(raw: &str, definition: bool) -> Option<std::ops::Range<usize>> {
    let bytes = raw.as_bytes();
    let mut at = {
        let mut depth = 0;
        let mut index = 0;
        let mut found = None;
        while index < bytes.len() {
            if bytes[index] == b'\\' {
                index += 2;
                continue;
            }
            if !definition && bytes[index] == b'`' {
                let ticks = bytes[index..]
                    .iter()
                    .take_while(|byte| **byte == b'`')
                    .count();
                let mut cursor = index + ticks;
                let mut end = None;
                while cursor < bytes.len() {
                    if bytes[cursor] == b'`' {
                        let count = bytes[cursor..]
                            .iter()
                            .take_while(|byte| **byte == b'`')
                            .count();
                        if count == ticks {
                            end = Some(cursor + count);
                            break;
                        }
                        cursor += count;
                    } else {
                        cursor += 1;
                    }
                }
                if let Some(end) = end {
                    index = end;
                    continue;
                }
            }
            if bytes[index] == b'[' {
                depth += 1;
            }
            if bytes[index] == b']' {
                depth -= 1;
                if depth == 0
                    && bytes.get(index + 1) == Some(if definition { &b':' } else { &b'(' })
                {
                    found = Some(index + 2);
                    break;
                }
            }
            index += 1;
        }
        found?
    };
    while bytes.get(at).is_some_and(u8::is_ascii_whitespace) {
        at += 1;
    }
    let angled = bytes.get(at) == Some(&b'<');
    if angled {
        at += 1;
    }
    let start = at;
    let mut depth = 0;
    while at < bytes.len() {
        let byte = bytes[at];
        if byte == b'\\' {
            at += 2;
            continue;
        }
        if angled {
            if byte == b'>' {
                break;
            }
        } else {
            if byte.is_ascii_whitespace() || byte == b')' && depth == 0 {
                break;
            }
            if byte == b'(' {
                depth += 1;
            }
            if byte == b')' {
                depth -= 1;
            }
        }
        at += 1;
    }
    (at > start && at <= raw.len()).then_some(start..at)
}

fn markdown_destinations(content: &str, offset: usize) -> Vec<(std::ops::Range<usize>, String)> {
    use pulldown_cmark::{Event, LinkType, Parser, Tag};
    let body = &content[offset..];
    let parser = Parser::new_ext(body, markdown::options());
    let mut result = Vec::new();
    for (_, definition) in parser.reference_definitions().iter() {
        if let Some(range) = destination(&body[definition.span.clone()], true) {
            result.push((
                offset + definition.span.start + range.start
                    ..offset + definition.span.start + range.end,
                definition.dest.to_string(),
            ));
        }
    }
    for (event, span) in parser.into_offset_iter() {
        let target = match event {
            Event::Start(
                Tag::Link {
                    link_type: LinkType::Inline,
                    dest_url,
                    ..
                }
                | Tag::Image {
                    link_type: LinkType::Inline,
                    dest_url,
                    ..
                },
            ) => dest_url,
            _ => continue,
        };
        if let Some(range) = destination(&body[span.clone()], false) {
            result.push((
                offset + span.start + range.start..offset + span.start + range.end,
                target.to_string(),
            ));
        }
    }
    result
}

fn relative_url(source: &str, target: &str) -> String {
    let source: Vec<_> = source
        .rsplit_once('/')
        .map_or("", |(dir, _)| dir)
        .split('/')
        .filter(|part| !part.is_empty())
        .collect();
    let target: Vec<_> = target.split('/').collect();
    let common = source
        .iter()
        .zip(&target)
        .take_while(|(a, b)| a == b)
        .count();
    let path = std::iter::repeat_n("..", source.len() - common)
        .chain(target[common..].iter().copied())
        .collect::<Vec<_>>()
        .join("/");
    path.replace('%', "%25")
        .replace(' ', "%20")
        .replace('#', "%23")
        .replace('?', "%3F")
        .replace('(', "%28")
        .replace(')', "%29")
        .replace('<', "%3C")
        .replace('>', "%3E")
}

impl Plan {
    pub fn prepare(v: &Vault, from: &str, to: &str, expected: &str) -> Result<Self> {
        Self::prepare_inner(v, from, to, Some(expected), false)
    }
    pub fn prepare_directory(v: &Vault, from: &str, name: &str) -> Result<Self> {
        if name.is_empty() || name.contains(['/', '\\']) {
            return Err(Error::InvalidPath("Введите имя папки без пути.".into()));
        }
        let parent = from.rsplit_once('/').map_or("", |(parent, _)| parent);
        let to = if parent.is_empty() {
            name.into()
        } else {
            format!("{parent}/{name}")
        };
        Self::prepare_inner(v, from, &to, None, true)
    }
    fn prepare_inner(
        v: &Vault,
        from: &str,
        to: &str,
        expected: Option<&str>,
        directory: bool,
    ) -> Result<Self> {
        if state(v, &[])?.is_some_and(|s| s.pending) {
            return Err(failure(
                "Сначала восстановите незавершённое переименование.",
            ));
        }
        let from = if directory {
            from.to_owned()
        } else {
            canonical(v, from)?
        };
        let to = if directory {
            to.to_owned()
        } else {
            canonical(v, to)?
        };
        let target = if directory {
            v.resolve(&to, false)?
        } else {
            v.note_path(&to)?
        };
        let tree = if directory {
            inventory(v, &from)?
        } else {
            BTreeMap::new()
        };
        if from == to {
            return Err(Error::InvalidPath("Укажите новое имя.".into()));
        }
        if target.exists() {
            return Err(Error::AlreadyExists);
        }
        if !target.parent().is_some_and(|p| p.is_dir()) {
            return Err(Error::InvalidPath(
                "Родительская папка должна существовать.".into(),
            ));
        }
        let all = catalog(v)?;
        if !directory && all.get(&from).map(|s| revision(s.as_bytes())).as_deref() != expected {
            return Err(Error::Conflict);
        }
        let before = database(all.keys().cloned())?;
        let after = database(all.keys().map(|p| remap(p, &from, &to, directory)))?;
        let mut files = Vec::new();
        let mut contents = Vec::new();
        let mut changes = Vec::new();
        let mut unresolved = 0;
        let order: Vec<_> = if directory {
            all.keys().collect()
        } else {
            std::iter::once(&from)
                .chain(all.keys().filter(|p| **p != from))
                .collect()
        };
        for path in order {
            let content = &all[path];
            let after_path = remap(path, &from, &to, directory);
            let mut replacements = Vec::new();
            let parsed = markdown::parse(content);
            for link in parsed.links {
                let old = links::resolve(&before, path, &link.target)?;
                let Some(target) = old.path else {
                    unresolved += 1;
                    continue;
                };
                let desired = remap(&target, &from, &to, directory);
                if links::resolve(&after, &after_path, &link.target)?
                    .path
                    .as_ref()
                    == Some(&desired)
                {
                    continue;
                }
                let mut replacement = if link.target.to_lowercase().ends_with(".md")
                    || link.target.to_lowercase().ends_with(".markdown")
                {
                    desired.clone()
                } else {
                    desired
                        .strip_suffix(".markdown")
                        .or_else(|| desired.strip_suffix(".md"))
                        .unwrap_or(&desired)
                        .to_owned()
                };
                if !link.target.contains('/') {
                    let short = replacement.rsplit('/').next().unwrap_or(&replacement);
                    if links::resolve(&after, &after_path, short)?.path.as_ref() == Some(&desired) {
                        replacement = short.to_owned();
                    }
                }
                // Root-qualified spelling must still resolve after moving the source.
                if links::resolve(&after, &after_path, &replacement)?
                    .path
                    .as_ref()
                    != Some(&desired)
                {
                    return Err(Error::Transaction(format!(
                        "Не удалось однозначно обновить ссылку в {path}."
                    )));
                }
                let mut rendered = content[link.start..link.end].to_owned();
                rendered.replace_range(
                    link.target_start - link.start..link.target_end - link.start,
                    &replacement,
                );
                changes.push(Change {
                    path: path.clone(),
                    line: link.line,
                    before: content[link.start..link.end].chars().take(240).collect(),
                    after: rendered.chars().take(240).collect(),
                });
                replacements.push((link.target_start, link.target_end, replacement));
            }
            for (range, url) in markdown_destinations(content, parsed.body_offset) {
                let suffix_at = url.find(['#', '?']).unwrap_or(url.len());
                let (url_path, suffix) = url.split_at(suffix_at);
                if url_path.is_empty() || url_path.contains(':') || url_path.starts_with('/') {
                    continue;
                }
                let Ok(mut target) = crate::attachments::relative_target(path, url_path) else {
                    continue;
                };
                if let Some(actual) = all
                    .keys()
                    .find(|candidate| links::key(candidate) == links::key(&target))
                {
                    target = actual.clone();
                }
                let desired = remap(&target, &from, &to, directory);
                let moved_target = desired != target;
                if after_path == *path && !moved_target {
                    continue;
                }
                if !moved_target && !v.resolve(&target, false)?.exists() {
                    continue;
                }
                if crate::attachments::relative_target(&after_path, url_path)
                    .as_ref()
                    .is_ok_and(|resolved| resolved == &desired)
                {
                    continue;
                }
                let replacement = relative_url(&after_path, &desired) + suffix;
                let raw = &content[range.clone()];
                let mut unescaped = String::new();
                let mut chars = raw.chars().peekable();
                while let Some(character) = chars.next() {
                    if character == '\\' && chars.peek().is_some_and(char::is_ascii_punctuation) {
                        if let Some(next) = chars.next() {
                            unescaped.push(next);
                        }
                    } else {
                        unescaped.push(character);
                    }
                }
                if unescaped != url {
                    return Err(Error::Transaction(format!(
                        "Ссылка в {path} содержит неподдерживаемое экранирование. Перенос отменён."
                    )));
                }
                changes.push(Change {
                    path: path.clone(),
                    line: content[..range.start]
                        .bytes()
                        .filter(|byte| *byte == b'\n')
                        .count()
                        + 1,
                    before: content[range.clone()].chars().take(240).collect(),
                    after: replacement.clone(),
                });
                replacements.push((range.start, range.end, replacement));
            }
            replacements.sort_by_key(|replacement| replacement.0);
            let mut updated = content.clone();
            for (start, end, value) in replacements.into_iter().rev() {
                updated.replace_range(start..end, &value);
            }
            if *path != after_path || updated != *content {
                files.push(File {
                    path: path.clone(),
                    after_path: after_path.clone(),
                    before: revision(content.as_bytes()),
                    after: revision(updated.as_bytes()),
                });
                contents.push((content.clone(), updated));
            }
        }
        let id = format!(
            "r-{}-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map_err(|e| failure(e.to_string()))?
                .as_nanos(),
            NEXT.fetch_add(1, Ordering::Relaxed)
        );
        let previous = pointer(v)?.id;
        Ok(Self {
            manifest: Manifest {
                version: 1,
                id,
                from,
                to,
                state: "prepared".into(),
                previous,
                files,
                changes,
                unresolved,
                directory,
                tree,
            },
            contents,
            stamps: all
                .into_iter()
                .map(|(p, c)| (p, revision(c.as_bytes())))
                .collect(),
        })
    }
    pub fn preview(&self, open: &[String], offset: usize) -> Preview {
        let m = &self.manifest;
        Preview {
            token: m.id.clone(),
            from: m.from.clone(),
            to: m.to.clone(),
            files: m.files.len(),
            links: m.changes.len(),
            unresolved: m.unresolved,
            changes: m.changes.iter().skip(offset).take(50).cloned().collect(),
            has_more: offset.saturating_add(50) < m.changes.len(),
            affected_open_paths: affected(m, open),
        }
    }
    pub fn apply(mut self, v: &Vault) -> Result<Applied> {
        if state(v, &[])?.is_some_and(|s| s.pending) || pointer(v)?.id != self.manifest.previous {
            return Err(Error::Conflict);
        }
        let current: BTreeMap<_, _> = catalog(v)?
            .into_iter()
            .map(|(p, c)| (p, revision(c.as_bytes())))
            .collect();
        if current != self.stamps {
            return Err(Error::Transaction(
                "Хранилище изменилось после предпросмотра. Постройте новый предпросмотр.".into(),
            ));
        }
        let target = if self.manifest.directory {
            v.resolve(&self.manifest.to, false)?
        } else {
            v.note_path(&self.manifest.to)?
        };
        if self.manifest.directory && inventory(v, &self.manifest.from)? != self.manifest.tree {
            return Err(Error::Conflict);
        }
        if target.exists() {
            return Err(Error::AlreadyExists);
        }
        let directory = operation_dir(v, &self.manifest.id, true)?;
        for (i, (before, after)) in self.contents.iter().enumerate() {
            atomic_write(
                &directory.join(format!("{i}-before.txt")),
                before.as_bytes(),
                false,
            )?;
            atomic_write(
                &directory.join(format!("{i}-after.txt")),
                after.as_bytes(),
                false,
            )?;
        }
        write_manifest(v, &self.manifest)?;
        set_pointer(v, Some(self.manifest.id.clone()))?;
        let apply = (|| {
            if self.manifest.directory {
                move_directory(v, &self.manifest.from, &self.manifest.to)?;
            } else {
                let source = &self.manifest.files[0];
                v.rename_note(&source.path, &source.after_path, &source.before)
                    .map_err(|e| {
                        Error::Transaction(format!(
                            "Перенос {} → {}: {e}",
                            source.path, source.after_path
                        ))
                    })?;
            }
            for (file, (_, after)) in self.manifest.files.iter().zip(&self.contents) {
                if file.before != file.after {
                    v.save_note(&file.after_path, after, &file.before)
                        .map_err(|e| {
                            Error::Transaction(format!(
                                "Обновление ссылок в {}: {e}",
                                file.after_path
                            ))
                        })?;
                }
            }
            self.manifest.state = "committed".into();
            write_manifest(v, &self.manifest)
        })();
        if let Err(error) = apply {
            self.manifest.state = "prepared".into();
            return match restore(v, &mut self.manifest, false) {
                Ok(()) => Err(Error::Transaction(format!(
                    "Переименование отменено, файлы восстановлены: {error}"
                ))),
                Err(recovery) => Err(failure(format!(
                    "{error}. Требуется восстановление: {recovery}"
                ))),
            };
        }
        let note = Note {
            path: self.manifest.to.clone(),
            content: if self.manifest.directory {
                String::new()
            } else {
                self.contents[0].1.clone()
            },
            revision: if self.manifest.directory {
                String::new()
            } else {
                self.manifest.files[0].after.clone()
            },
        };
        Ok(Applied {
            changed_paths: self
                .manifest
                .files
                .iter()
                .flat_map(|f| [f.path.clone(), f.after_path.clone()])
                .collect(),
            from: self.manifest.from,
            note,
            directory: self.manifest.directory,
        })
    }
}

fn safe(path: &std::path::Path) -> Result<()> {
    let m = fs::symlink_metadata(path)?;
    if is_link(&m) {
        return Err(failure("Журнал содержит ссылку/reparse point."));
    }
    Ok(())
}
fn private(v: &Vault, create: bool) -> Result<PathBuf> {
    let path = v.root().join(".aether");
    if create && !path.exists() {
        fs::create_dir(&path)?;
    }
    if path.exists() {
        safe(&path)?;
        if !path.is_dir() {
            return Err(failure(".aether должна быть папкой."));
        }
    }
    Ok(path)
}
fn valid_id(id: &str) -> bool {
    id.starts_with("r-")
        && id.len() < 100
        && id
            .bytes()
            .all(|b| b.is_ascii_digit() || b == b'r' || b == b'-')
}
fn operation_dir(v: &Vault, id: &str, create: bool) -> Result<PathBuf> {
    if !valid_id(id) {
        return Err(failure("Недопустимый ID журнала."));
    }
    let parent = private(v, create)?.join("renames");
    if create && !parent.exists() {
        fs::create_dir(&parent)?;
    }
    safe(&parent)?;
    let path = parent.join(id);
    if create {
        fs::create_dir(&path)?;
    }
    safe(&path)?;
    Ok(path)
}
fn pointer(v: &Vault) -> Result<Pointer> {
    let path = private(v, false)?.join("rename.json");
    if !path.exists() {
        return Ok(Pointer::default());
    }
    safe(&path)?;
    if fs::metadata(&path)?.len() > 1024 {
        return Err(failure("Повреждён указатель журнала."));
    }
    serde_json::from_slice(&fs::read(path)?)
        .map_err(|e| failure(format!("Повреждён журнал переименования: {e}")))
}
fn set_pointer(v: &Vault, id: Option<String>) -> Result<()> {
    let path = private(v, true)?.join("rename.json");
    if path.exists() {
        safe(&path)?;
    }
    atomic_write(&path, &json(&Pointer { id })?, path.exists())
}
fn write_manifest(v: &Vault, m: &Manifest) -> Result<()> {
    let path = operation_dir(v, &m.id, false)?.join("manifest.json");
    if path.exists() {
        safe(&path)?;
    }
    atomic_write(&path, &json(m)?, path.exists())
}
fn read_manifest(v: &Vault, id: &str) -> Result<Manifest> {
    let path = operation_dir(v, id, false)?.join("manifest.json");
    safe(&path)?;
    if fs::metadata(&path)?.len() > 32 * 1024 * 1024 {
        return Err(failure("Слишком большой журнал."));
    }
    let m: Manifest =
        serde_json::from_slice(&fs::read(path)?).map_err(|e| failure(e.to_string()))?;
    if m.version != 1
        || m.id != id
        || (!m.directory
            && (m.files.is_empty() || m.files[0].path != m.from || m.files[0].after_path != m.to))
        || m.from == m.to
        || !matches!(
            m.state.as_str(),
            "prepared" | "committed" | "undoing" | "rolledBack" | "undone"
        )
    {
        return Err(failure("Повреждён журнал переименования."));
    }
    let mut paths = std::collections::HashSet::new();
    if m.directory {
        v.resolve(&m.from, false)?;
        v.resolve(&m.to, false)?;
        if m.tree.get("").map(String::as_str) != Some("dir") {
            return Err(failure("Повреждён список папки."));
        }
        for relative in m.tree.keys() {
            if !relative.is_empty() {
                v.resolve(&format!("{}/{relative}", m.from), false)?;
            }
        }
    }
    for (i, f) in m.files.iter().enumerate() {
        canonical(v, &f.path)?;
        canonical(v, &f.after_path)?;
        if (if m.directory {
            remap(&f.path, &m.from, &m.to, true) != f.after_path
        } else {
            i > 0 && (f.path != f.after_path || f.path == m.from || f.path == m.to)
        }) || !paths.insert(f.path.clone())
        {
            return Err(failure("Повреждён список файлов журнала."));
        }
    }
    Ok(m)
}
fn current(v: &Vault, path: &str) -> Result<Option<String>> {
    let full = v.note_path(path)?;
    match fs::read(full) {
        Ok(bytes) => Ok(Some(revision(&bytes))),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(e.into()),
    }
}
pub fn state(v: &Vault, open: &[String]) -> Result<Option<RenameState>> {
    let mut id = pointer(v)?.id;
    let mut seen = std::collections::HashSet::new();
    while let Some(value) = id {
        if !seen.insert(value.clone()) || seen.len() > 1000 {
            return Err(failure("Цикл в журнале переименований."));
        }
        let m = read_manifest(v, &value)?;
        if matches!(m.state.as_str(), "undone" | "rolledBack") {
            id = m.previous;
            continue;
        }
        return Ok(Some(RenameState {
            id: m.id.clone(),
            from: m.from.clone(),
            to: m.to.clone(),
            pending: m.state != "committed",
            affected_open_paths: affected(&m, open),
        }));
    }
    Ok(None)
}
pub fn assert_writable(v: &Vault, path: &str) -> Result<()> {
    if state(v, &[path.into()])?.is_some_and(|s| s.pending && !s.affected_open_paths.is_empty()) {
        return Err(failure(
            "Этот файл затронут незавершённым переименованием. Сначала выполните восстановление.",
        ));
    }
    Ok(())
}
fn restore(v: &Vault, m: &mut Manifest, undo: bool) -> Result<()> {
    if m.directory {
        return restore_directory(v, m, undo);
    }
    let directory = operation_dir(v, &m.id, false)?;
    let mut backups = Vec::new();
    let mut observed = Vec::new();
    // Preflight every backup and current file before changing even one Markdown file.
    for (i, file) in m.files.iter().enumerate() {
        let mut pair = Vec::new();
        for (label, hash) in [("before", &file.before), ("after", &file.after)] {
            let path = directory.join(format!("{i}-{label}.txt"));
            safe(&path)?;
            let bytes = fs::read(path)?;
            if revision(&bytes) != *hash {
                return Err(failure(
                    "Резервная копия повреждена. Файлы оставлены без изменений.",
                ));
            }
            pair.push(String::from_utf8(bytes).map_err(|e| failure(e.to_string()))?);
        }
        backups.push(pair.remove(0));
        let now = current(v, &file.after_path)?;
        if i > 0
            && !now.as_ref().is_some_and(|rev| {
                if undo {
                    rev == &file.after
                } else {
                    rev == &file.before || rev == &file.after
                }
            })
        {
            return Err(failure(format!(
                "Внешние изменения в {}. Сохранены текущий файл и резервные копии.",
                file.after_path
            )));
        }
        observed.push(now);
    }
    let source = &m.files[0];
    let from = current(v, &m.from)?;
    let to = current(v, &m.to)?;
    let known = |hash: &Option<String>| {
        hash.as_ref()
            .is_some_and(|r| r == &source.before || r == &source.after)
    };
    if undo {
        if from.is_some() || to.as_deref() != Some(&source.after) {
            return Err(failure(
                "Исходный или целевой файл изменился после переименования.",
            ));
        }
        m.state = "undoing".into();
        write_manifest(v, m)?;
    } else if (from.is_none() && to.is_none())
        || from.as_ref().is_some_and(|_| !known(&from))
        || to.as_ref().is_some_and(|_| !known(&to))
    {
        return Err(failure(
            "Нельзя безопасно восстановить имя: файл удалён или изменён извне.",
        ));
    }
    if from.is_some()
        && to.is_some()
        && !same_file::is_same_file(v.note_path(&m.from)?, v.note_path(&m.to)?)?
    {
        return Err(failure(
            "Целевой путь занят независимым файлом. Он не будет удалён.",
        ));
    }
    for (i, file) in m.files.iter().enumerate().skip(1) {
        let rev = observed[i].as_deref().ok_or(Error::Conflict)?;
        if rev != file.before {
            v.save_note(&file.path, &backups[i], rev)?;
        } else if current(v, &file.path)?.as_deref() != Some(rev) {
            return Err(Error::Conflict);
        }
    }
    if from.is_some() && to.is_some() {
        if !same_file::is_same_file(v.note_path(&m.from)?, v.note_path(&m.to)?)?
            || current(v, &m.from)? != from
            || current(v, &m.to)? != to
        {
            return Err(Error::Conflict);
        }
        fs::remove_file(v.note_path(&m.to)?)?;
    }
    let path = if from.is_some() { &m.from } else { &m.to };
    let rev = if from.is_some() { from } else { to }.ok_or(Error::Conflict)?;
    if rev != source.before {
        v.save_note(path, &backups[0], &rev)?;
    } else if current(v, path)?.as_deref() != Some(&rev) {
        return Err(Error::Conflict);
    }
    if path == &m.to {
        v.rename_note(&m.to, &m.from, &source.before)?;
    }
    m.state = if undo { "undone" } else { "rolledBack" }.into();
    write_manifest(v, m)?;
    set_pointer(v, m.previous.clone())
}

fn restore_directory(v: &Vault, m: &mut Manifest, undo: bool) -> Result<()> {
    let old = v.resolve(&m.from, false)?;
    let new = v.resolve(&m.to, false)?;
    if old.exists() == new.exists() {
        return Err(failure(
            "Имя папки занято или папка отсутствует. Файлы не изменены.",
        ));
    }
    let at_new = new.exists();
    if undo && !at_new {
        return Err(Error::Conflict);
    }
    let location = if at_new { &m.to } else { &m.from };
    let observed_tree = inventory(v, location)?;
    if observed_tree.keys().ne(m.tree.keys()) {
        return Err(failure("Состав папки изменился извне. Отмена остановлена."));
    }
    for (relative, original) in &m.tree {
        let now = &observed_tree[relative];
        if now == original {
            continue;
        }
        let original_path = format!("{}/{relative}", m.from);
        if !m
            .files
            .iter()
            .any(|file| file.path == original_path && &file.after == now)
        {
            return Err(failure("Содержимое папки изменилось извне."));
        }
    }
    let directory = operation_dir(v, &m.id, false)?;
    let mut backups = Vec::new();
    for (index, file) in m.files.iter().enumerate() {
        for (label, hash) in [("before", &file.before), ("after", &file.after)] {
            let path = directory.join(format!("{index}-{label}.txt"));
            safe(&path)?;
            let bytes = fs::read(path)?;
            if revision(&bytes) != *hash {
                return Err(failure("Повреждена резервная копия."));
            }
            if label == "before" {
                backups.push(String::from_utf8(bytes).map_err(|e| failure(e.to_string()))?);
            }
        }
        let path = if at_new { &file.after_path } else { &file.path };
        let now = current(v, path)?.ok_or(Error::Conflict)?;
        if now != file.after && (undo || now != file.before) {
            return Err(failure(format!("Внешние изменения в {path}.")));
        }
    }
    if undo {
        m.state = "undoing".into();
        write_manifest(v, m)?;
    }
    for (index, file) in m.files.iter().enumerate() {
        let path = if at_new { &file.after_path } else { &file.path };
        let now = current(v, path)?.ok_or(Error::Conflict)?;
        if now != file.before {
            v.save_note(path, &backups[index], &now)?;
        }
    }
    if at_new {
        move_directory(v, &m.to, &m.from)?;
    }
    m.state = if undo { "undone" } else { "rolledBack" }.into();
    write_manifest(v, m)?;
    set_pointer(v, m.previous.clone())
}
pub fn undo(v: &Vault, id: &str, recover: bool) -> Result<Applied> {
    let active = state(v, &[])?.ok_or_else(|| failure("Нет операции для отмены."))?;
    if active.id != id || active.pending != recover {
        return Err(Error::Conflict);
    }
    let mut m = read_manifest(v, id)?;
    restore(v, &mut m, !recover)?;
    Ok(Applied {
        changed_paths: m
            .files
            .iter()
            .flat_map(|f| [f.path.clone(), f.after_path.clone()])
            .collect(),
        from: m.to,
        note: if m.directory {
            Note {
                path: m.from.clone(),
                content: String::new(),
                revision: String::new(),
            }
        } else {
            v.read_note(&m.from)?
        },
        directory: m.directory,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    fn fixture() -> Result<(tempfile::TempDir, Vault)> {
        let dir = tempfile::tempdir()?;
        let v = Vault::open(dir.path())?;
        v.create_directory("A")?;
        v.create_directory("B")?;
        v.create_note("A/Target.md", "# Заголовок\r\n[[./Other#Раздел|алиас]]\r\n")?;
        v.create_note("A/Other.md", "other")?;
        v.create_note("Ref.md","\u{feff}---\nexample: '[[A/Target]]'\n---\n![[A/Target#Заголовок|подпись]]\r\n`[[A/Target]]`\r\n")?;
        Ok((dir, v))
    }
    #[test]
    fn preview_apply_undo_preserve_syntax_and_move_relative_links() -> Result<()> {
        let (_dir, v) = fixture()?;
        let original = v.read_note("Ref.md")?.content;
        let source = v.read_note("A/Target.md")?;
        let p = Plan::prepare(&v, &source.path, "B/New.md", &source.revision)?;
        assert_eq!(p.preview(&[], 0).links, 2);
        assert_eq!(v.read_note("Ref.md")?.content, original);
        p.apply(&v)?;
        assert!(v
            .read_note("Ref.md")?
            .content
            .contains("![[B/New#Заголовок|подпись]]"));
        assert!(v
            .read_note("B/New.md")?
            .content
            .contains("[[A/Other#Раздел|алиас]]"));
        let s = state(&v, &[])?.ok_or(Error::NoVault)?;
        undo(&v, &s.id, false)?;
        assert_eq!(v.read_note("Ref.md")?.content, original);
        assert_eq!(v.read_note(&source.path)?.content, source.content);
        assert!(state(&v, &[])?.is_none());
        Ok(())
    }
    #[test]
    fn preview_conflict_and_undo_external_edit_are_non_destructive() -> Result<()> {
        let (_dir, v) = fixture()?;
        let source = v.read_note("A/Target.md")?;
        let p = Plan::prepare(&v, &source.path, "B/New.md", &source.revision)?;
        v.create_note("new.md", "external")?;
        assert!(p.apply(&v).is_err());
        assert!(v.read_note(&source.path).is_ok());
        Plan::prepare(&v, &source.path, "B/New.md", &source.revision)?.apply(&v)?;
        let s = state(&v, &[])?.ok_or(Error::NoVault)?;
        fs::write(v.note_path("Ref.md")?, "external")?;
        assert!(undo(&v, &s.id, false).is_err());
        assert_eq!(v.read_note("Ref.md")?.content, "external");
        assert!(v.read_note("B/New.md").is_ok());
        Ok(())
    }
    #[test]
    fn interrupted_operation_recovers_and_independent_collision_is_preserved() -> Result<()> {
        let (_dir, v) = fixture()?;
        let source = v.read_note("A/Target.md")?;
        let p = Plan::prepare(&v, &source.path, "B/New.md", &source.revision)?;
        let directory = operation_dir(&v, &p.manifest.id, true)?;
        for (i, (a, b)) in p.contents.iter().enumerate() {
            atomic_write(
                &directory.join(format!("{i}-before.txt")),
                a.as_bytes(),
                false,
            )?;
            atomic_write(
                &directory.join(format!("{i}-after.txt")),
                b.as_bytes(),
                false,
            )?;
        }
        write_manifest(&v, &p.manifest)?;
        set_pointer(&v, Some(p.manifest.id.clone()))?;
        v.rename_note(&source.path, "B/New.md", &source.revision)?;
        assert!(assert_writable(&v, "B/New.md").is_err());
        assert_writable(&v, "unrelated.md")?;
        v.create_note(&source.path, &source.content)?;
        assert!(undo(&v, &p.manifest.id, true).is_err());
        assert!(v.read_note("B/New.md").is_ok());
        fs::remove_file(v.note_path(&source.path)?)?;
        fs::hard_link(v.note_path("B/New.md")?, v.note_path(&source.path)?)?;
        undo(&v, &p.manifest.id, true)?;
        assert_eq!(v.read_note(&source.path)?.content, source.content);
        Ok(())
    }

    #[test]
    fn ambiguity_shadowing_pagination_and_corrupt_backups() -> Result<()> {
        let (_dir, v) = fixture()?;
        v.create_note("B/Target.md", "unrelated")?;
        // Bare names currently resolve locally; moving a note must not redirect them.
        v.create_note("A/Local.md", &"[[Target#x|alias]]\n".repeat(60))?;
        v.create_note("Ambiguous.md", "[[Target]]\n[[Missing]]")?;
        let source = v.read_note("A/Target.md")?;
        let p = Plan::prepare(&v, &source.path, "B/New.md", &source.revision)?;
        let preview = p.preview(&[], 0);
        assert!(preview.has_more);
        assert_eq!(preview.changes.len(), 50);
        assert!(preview.unresolved >= 2);
        let rest = p.preview(&[], 50);
        assert_eq!(rest.changes.len(), 12);
        p.apply(&v)?;
        assert!(v
            .read_note("A/Local.md")?
            .content
            .starts_with("[[New#x|alias]]"));
        assert_eq!(
            v.read_note("Ambiguous.md")?.content,
            "[[Target]]\n[[Missing]]"
        );
        let s = state(&v, &[])?.ok_or(Error::NoVault)?;
        let directory = operation_dir(&v, &s.id, false)?;
        fs::write(directory.join("0-before.txt"), "corrupt")?;
        let before = v.read_note("Ref.md")?.content;
        assert!(undo(&v, &s.id, false).is_err());
        assert_eq!(v.read_note("Ref.md")?.content, before);
        assert!(v.read_note("B/New.md").is_ok());
        Ok(())
    }

    #[test]
    fn moving_notes_preserves_short_links_and_qualifies_shadowed_targets() -> Result<()> {
        let (_dir, v) = fixture()?;
        v.create_note("New.md", "unrelated")?;
        v.create_note("B/Other.md", "another note")?;
        v.create_note("A/Local.md", "[[Target#section|alias]]")?;
        let source = v.read_note("A/Target.md")?;
        Plan::prepare(&v, &source.path, "B/New.md", &source.revision)?.apply(&v)?;
        assert_eq!(
            v.read_note("A/Local.md")?.content,
            "[[B/New#section|alias]]"
        );
        assert!(v
            .read_note("B/New.md")?
            .content
            .contains("[[A/Other#Раздел|алиас]]"));
        assert_eq!(v.read_note("New.md")?.content, "unrelated");
        let moved = v.read_note("B/New.md")?;
        // Moving back without renaming must keep previously explicit spelling valid.
        Plan::prepare(&v, &moved.path, "A/Again.md", &moved.revision)?.apply(&v)?;
        assert!(v.read_note("Ref.md")?.content.contains("A/Again"));
        Ok(())
    }

    #[test]
    fn moves_markdown_links_images_and_reference_definitions_without_changing_labels() -> Result<()>
    {
        let (_dir, v) = fixture()?;
        let body = "\u{feff}---\nexample: '[keep](./Other.md)'\n---\n[label](./Other.md#head \"Title\")\n![image](./image%20x.png)\n[ref][id]\n\n[id]: ./Other.md\n\n`[code](./Other.md)`\n[web](https://example.com)\n";
        let reference =
            "[note](A/Move.md#anchor \"Title\")\n[again][moved]\n\n[moved]: A/Move.md\n";
        v.create_note("A/Move.md", body)?;
        v.create_note("MarkdownRef.md", reference)?;
        fs::write(v.resolve("A/image x.png", false)?, b"image")?;
        let source = v.read_note("A/Move.md")?;
        Plan::prepare(&v, &source.path, "B/Move.md", &source.revision)?.apply(&v)?;
        let moved = v.read_note("B/Move.md")?.content;
        assert!(moved.contains("[label](../A/Other.md#head \"Title\")"));
        assert!(moved.contains("![image](../A/image%20x.png)"));
        assert!(moved.contains("[id]: ../A/Other.md"));
        assert!(moved.contains("'[keep](./Other.md)'"));
        assert!(moved.contains("`[code](./Other.md)`"));
        assert_eq!(
            v.read_note("MarkdownRef.md")?.content,
            reference.replace("A/Move.md", "B/Move.md")
        );
        let state = state(&v, &[])?.ok_or(Error::NoVault)?;
        undo(&v, &state.id, false)?;
        assert_eq!(v.read_note("A/Move.md")?.content, body);
        assert_eq!(v.read_note("MarkdownRef.md")?.content, reference);
        Ok(())
    }

    #[test]
    fn folder_rename_updates_nested_notes_assets_and_links_and_undoes_everything() -> Result<()> {
        let (_temp, v) = fixture()?;
        v.create_directory("A/Empty")?;
        v.create_directory("A/Nested")?;
        v.create_note("A/Nested/Child.md", "[[../Other]]\n![asset](../image.png)")?;
        fs::write(v.resolve("A/image.png", false)?, b"asset")?;
        v.create_note(
            "Markdown.md",
            "[note](A/Target.md#heading)\n![asset](A/image.png)",
        )?;
        let original = v.read_note("Ref.md")?.content;
        let result = Plan::prepare_directory(&v, "A", "Moved")?.apply(&v)?;
        assert!(result.directory);
        assert!(!v.resolve("A", false)?.exists());
        assert!(v.resolve("Moved/Empty", false)?.is_dir());
        assert_eq!(fs::read(v.resolve("Moved/image.png", false)?)?, b"asset");
        assert_eq!(
            v.read_note("Moved/Nested/Child.md")?.content,
            "[[../Other]]\n![asset](../image.png)"
        );
        assert!(v.read_note("Ref.md")?.content.contains("Moved/Target"));
        assert_eq!(
            v.read_note("Markdown.md")?.content,
            "[note](Moved/Target.md#heading)\n![asset](Moved/image.png)"
        );
        let active = state(&v, &[])?.ok_or(Error::Conflict)?;
        assert!(undo(&v, &active.id, false)?.directory);
        assert_eq!(v.read_note("Ref.md")?.content, original);
        assert!(v.resolve("A/Empty", false)?.is_dir());
        assert_eq!(fs::read(v.resolve("A/image.png", false)?)?, b"asset");
        Ok(())
    }

    #[test]
    fn folder_operations_preserve_collisions_external_assets_and_asset_only_folders() -> Result<()>
    {
        let (_temp, v) = fixture()?;
        assert!(matches!(
            Plan::prepare_directory(&v, "A", "B"),
            Err(Error::AlreadyExists)
        ));
        fs::write(v.resolve("A/asset.bin", false)?, b"one")?;
        let plan = Plan::prepare_directory(&v, "A", "Moved")?;
        fs::write(v.resolve("A/asset.bin", false)?, b"external")?;
        assert!(plan.apply(&v).is_err());
        assert_eq!(fs::read(v.resolve("A/asset.bin", false)?)?, b"external");
        v.create_directory("OnlyAssets")?;
        v.create_directory("OnlyAssets/Empty")?;
        fs::write(v.resolve("OnlyAssets/file.bin", false)?, b"data")?;
        Plan::prepare_directory(&v, "OnlyAssets", "NewAssets")?.apply(&v)?;
        let active = state(&v, &[])?.ok_or(Error::Conflict)?;
        fs::write(v.resolve("NewAssets/file.bin", false)?, b"changed")?;
        assert!(undo(&v, &active.id, false).is_err());
        fs::write(v.resolve("NewAssets/file.bin", false)?, b"data")?;
        undo(&v, &active.id, false)?;
        assert!(v.resolve("OnlyAssets/Empty", false)?.is_dir());
        let trash = trash_directory(&v, "OnlyAssets")?;
        assert!(!v.resolve("OnlyAssets", false)?.exists());
        assert_eq!(
            fs::read(PathBuf::from(trash.trash).join("file.bin"))?,
            b"data"
        );
        assert!(v.read_note("A/Target.md").is_ok());
        for path in ["", "../outside", ".aether"] {
            assert!(trash_directory(&v, path).is_err());
        }
        Ok(())
    }

    #[test]
    fn folder_recovery_moves_back_and_trash_preserves_arbitrary_bytes() -> Result<()> {
        let (_temp, v) = fixture()?;
        fs::write(v.resolve("A/bad.md", false)?, [0xff, 0xfe])?;
        let trash = trash_directory(&v, "A")?;
        assert_eq!(
            fs::read(PathBuf::from(trash.trash).join("bad.md"))?,
            [0xff, 0xfe]
        );
        v.create_directory("Empty")?;
        let mut plan = Plan::prepare_directory(&v, "Empty", "Renamed")?;
        let directory = operation_dir(&v, &plan.manifest.id, true)?;
        for (index, (before, after)) in plan.contents.iter().enumerate() {
            atomic_write(
                &directory.join(format!("{index}-before.txt")),
                before.as_bytes(),
                false,
            )?;
            atomic_write(
                &directory.join(format!("{index}-after.txt")),
                after.as_bytes(),
                false,
            )?;
        }
        write_manifest(&v, &plan.manifest)?;
        set_pointer(&v, Some(plan.manifest.id.clone()))?;
        move_directory(&v, "Empty", "Renamed")?;
        assert!(state(&v, &[])?.is_some_and(|state| state.pending));
        restore(&v, &mut plan.manifest, false)?;
        assert!(v.resolve("Empty", false)?.is_dir());
        assert!(!v.resolve("Renamed", false)?.exists());
        Ok(())
    }

    #[cfg(windows)]
    #[test]
    fn folder_write_failure_rolls_back_the_directory_and_links() -> Result<()> {
        let (_temp, v) = fixture()?;
        let original = v.read_note("Ref.md")?.content;
        let path = v.note_path("Ref.md")?;
        let original_permissions = fs::metadata(&path)?.permissions();
        let mut permissions = original_permissions.clone();
        permissions.set_readonly(true);
        fs::set_permissions(&path, permissions)?;
        assert!(Plan::prepare_directory(&v, "A", "Moved")?
            .apply(&v)
            .is_err());
        assert!(v.resolve("A", false)?.is_dir());
        assert!(!v.resolve("Moved", false)?.exists());
        assert_eq!(v.read_note("Ref.md")?.content, original);
        fs::set_permissions(path, original_permissions)?;
        Ok(())
    }

    #[cfg(windows)]
    #[test]
    fn write_failure_automatically_rolls_back_all_previous_writes() -> Result<()> {
        let (_dir, v) = fixture()?;
        let source = v.read_note("A/Target.md")?;
        let before = v.read_note("Ref.md")?;
        let plan = Plan::prepare(&v, &source.path, "B/New.md", &source.revision)?;
        let path = v.note_path("Ref.md")?;
        let original_permissions = fs::metadata(&path)?.permissions();
        let mut permissions = original_permissions.clone();
        permissions.set_readonly(true);
        fs::set_permissions(&path, permissions.clone())?;
        let result = plan.apply(&v);
        fs::set_permissions(&path, original_permissions)?;
        assert!(result.is_err());
        assert_eq!(v.read_note(&source.path)?.content, source.content);
        assert_eq!(v.read_note("Ref.md")?.content, before.content);
        assert!(!v.note_path("B/New.md")?.exists());
        assert!(state(&v, &[])?.is_none());
        Ok(())
    }
}
