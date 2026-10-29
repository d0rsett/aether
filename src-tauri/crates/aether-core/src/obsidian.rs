//! Offset-preserving adaptations of Obsidian's inline syntax.
use pulldown_cmark::{Event, LinkType, Options, Parser, Tag};
use std::ops::Range;
use std::{collections::BTreeMap, fs, io::Read};

/// Read Obsidian's type assignments without mutating its configuration.
pub fn property_types(vault: &crate::vault::Vault) -> crate::Result<BTreeMap<String, String>> {
    let path = vault.resolve(".obsidian/types.json", false)?;
    let file = match fs::File::open(path) {
        Ok(file) => file,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(BTreeMap::new()),
        Err(error) => return Err(error.into()),
    };
    let mut data = Vec::new();
    file.take(512 * 1024 + 1).read_to_end(&mut data)?;
    if data.len() > 512 * 1024 {
        return Err(crate::Error::Io(
            "Настройки типов Obsidian слишком велики.".into(),
        ));
    }
    let text = std::str::from_utf8(&data)
        .map_err(|_| crate::Error::Io("Не удалось прочитать типы свойств Obsidian.".into()))?;
    let value: serde_json::Value = serde_json::from_str(text.trim_start_matches('\u{feff}'))
        .map_err(|_| crate::Error::Io("Не удалось прочитать типы свойств Obsidian.".into()))?;
    if value.is_object() && value.get("types").is_none() {
        return Ok(BTreeMap::new());
    }
    let Some(types) = value.get("types").and_then(serde_json::Value::as_object) else {
        return Err(crate::Error::Io(
            "Некорректный файл типов свойств Obsidian.".into(),
        ));
    };
    let mut output = BTreeMap::new();
    for (name, value) in types {
        let kind = value
            .as_str()
            .filter(|kind| !kind.is_empty() && kind.len() <= 80)
            .ok_or_else(|| {
                crate::Error::Io("Некорректный тип свойства в настройках Obsidian.".into())
            })?;
        if name.is_empty() || name.len() > 256 || name.chars().any(char::is_control) {
            return Err(crate::Error::Io(
                "Некорректное имя свойства в настройках Obsidian.".into(),
            ));
        }
        output.insert(name.clone(), kind.to_owned());
    }
    Ok(output)
}

/// Change one vault-wide assignment, preserving unrelated settings and detecting stale clients.
pub fn set_property_type(
    vault: &crate::vault::Vault,
    name: &str,
    kind: &str,
    expected: &BTreeMap<String, String>,
) -> crate::Result<BTreeMap<String, String>> {
    if name.trim().is_empty()
        || name.len() > 256
        || name.chars().any(char::is_control)
        || !matches!(
            kind,
            "text" | "multitext" | "number" | "date" | "datetime" | "checkbox"
        )
        || matches!(name, "tags" | "aliases" | "cssclasses")
    {
        return Err(crate::Error::Io(
            "Недопустимое имя или тип свойства.".into(),
        ));
    }
    let path = vault.resolve(".obsidian/types.json", false)?;
    if fs::metadata(&path).is_ok_and(|metadata| metadata.len() > 512 * 1024) {
        return Err(crate::Error::Io(
            "Настройки типов Obsidian слишком велики.".into(),
        ));
    }
    let before = match fs::read(&path) {
        Ok(bytes) => Some(bytes),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => None,
        Err(error) => return Err(error.into()),
    };
    if property_types(vault)? != *expected {
        return Err(crate::Error::Conflict);
    }
    let text = before
        .as_deref()
        .map(std::str::from_utf8)
        .transpose()
        .map_err(|_| crate::Error::Io("Не удалось прочитать настройки Obsidian.".into()))?
        .unwrap_or("{}");
    let mut document: serde_json::Value = serde_json::from_str(text.trim_start_matches('\u{feff}'))
        .map_err(|_| crate::Error::Io("Не удалось прочитать настройки Obsidian.".into()))?;
    let object = document
        .as_object_mut()
        .ok_or_else(|| crate::Error::Io("Некорректные настройки Obsidian.".into()))?;
    let types = object
        .entry("types")
        .or_insert_with(|| serde_json::json!({}))
        .as_object_mut()
        .ok_or_else(|| crate::Error::Io("Некорректные типы свойств.".into()))?;
    types.insert(name.to_owned(), kind.into());
    let mut output = serde_json::to_string_pretty(&document)
        .map_err(|error| crate::Error::Io(error.to_string()))?
        + "\n";
    if text.contains("\r\n") {
        output = output.replace('\n', "\r\n");
    }
    if text.starts_with('\u{feff}') {
        output.insert(0, '\u{feff}');
    }
    let directory = vault.resolve(".obsidian", false)?;
    if !directory.exists() {
        fs::create_dir(&directory)?;
    }
    let path = vault.resolve(".obsidian/types.json", false)?;
    if let Some(bytes) = before {
        let revision = crate::files::revision(&bytes);
        if fs::read(&path)? != bytes {
            return Err(crate::Error::Conflict);
        }
        crate::files::atomic_write_checked(&path, output.as_bytes(), true, Some(&revision))?;
    } else {
        crate::files::atomic_write(&path, output.as_bytes(), false)?;
    }
    property_types(vault)
}

pub fn template_folder(vault: &crate::vault::Vault) -> crate::Result<String> {
    let path = vault.resolve(".obsidian/templates.json", false)?;
    let file = match fs::File::open(path) {
        Ok(file) => file,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok("Templates".into()),
        Err(error) => return Err(error.into()),
    };
    let mut bytes = Vec::new();
    file.take(65537).read_to_end(&mut bytes)?;
    if bytes.len() > 65536 {
        return Err(crate::Error::Io(
            "Настройки шаблонов слишком велики.".into(),
        ));
    }
    let text = std::str::from_utf8(&bytes)
        .map_err(|_| crate::Error::Io("Не удалось прочитать настройки шаблонов.".into()))?;
    let config: serde_json::Value = serde_json::from_str(text.trim_start_matches('\u{feff}'))
        .map_err(|_| crate::Error::Io("Некорректные настройки шаблонов.".into()))?;
    let folder = config
        .get("folder")
        .and_then(serde_json::Value::as_str)
        .unwrap_or("Templates");
    vault.resolve(folder, true)?;
    Ok(folder.into())
}

pub fn property_catalog(
    vault: &crate::vault::Vault,
) -> crate::Result<BTreeMap<String, Vec<String>>> {
    let mut catalog: BTreeMap<String, Vec<String>> = BTreeMap::new();
    let mut folders = vec![String::new()];
    let mut remaining = 1000;
    let mut directories = 1000;
    while let Some(folder) = folders.pop() {
        if remaining == 0 || directories == 0 {
            break;
        }
        directories -= 1;
        for entry in vault.list(&folder)? {
            if entry.is_directory {
                folders.push(entry.path);
                continue;
            }
            if !entry.path.to_lowercase().ends_with(".md") || remaining == 0 {
                continue;
            }
            remaining -= 1;
            let path = vault.resolve(&entry.path, true)?;
            let mut bytes = Vec::new();
            fs::File::open(path)?.take(65536).read_to_end(&mut bytes)?;
            let Ok(text) = std::str::from_utf8(&bytes) else {
                continue;
            };
            let normalized = text.trim_start_matches('\u{feff}').replace("\r\n", "\n");
            let Some(body) = normalized.strip_prefix("---\n") else {
                continue;
            };
            let Some((header, _)) = body.split_once("\n---") else {
                continue;
            };
            // Suggestions must not expand arbitrary YAML alias graphs.
            if header.contains('&') || header.contains('*') {
                continue;
            }
            let Ok(serde_yaml_ng::Value::Mapping(mapping)) =
                serde_yaml_ng::from_str::<serde_yaml_ng::Value>(header)
            else {
                continue;
            };
            for (key, value) in mapping {
                let Some(key) = key
                    .as_str()
                    .filter(|key| !key.is_empty() && key.len() <= 256)
                else {
                    continue;
                };
                if catalog.len() >= 500 && !catalog.contains_key(key) {
                    continue;
                }
                let values = catalog.entry(key.into()).or_default();
                let candidates = match value {
                    serde_yaml_ng::Value::Sequence(items) => items,
                    other => vec![other],
                };
                for candidate in candidates {
                    let text = match candidate {
                        serde_yaml_ng::Value::String(text) => text,
                        serde_yaml_ng::Value::Number(number) => number.to_string(),
                        _ => continue,
                    };
                    if text.len() <= 256 && values.len() < 50 && !values.contains(&text) {
                        values.push(text);
                    }
                }
            }
        }
    }
    Ok(catalog)
}

pub fn comments(source: &str) -> Vec<Range<usize>> {
    let protected = protected(source);
    let mut ranges = Vec::new();
    let mut at = 0;
    while at + 1 < source.len() {
        if source.as_bytes()[at..].starts_with(b"%%")
            && !escaped(source, at)
            && !protected.iter().any(|range| range.contains(&at))
        {
            let mut end = at + 2;
            while end + 1 < source.len()
                && !(source.as_bytes()[end..].starts_with(b"%%") && !escaped(source, end))
            {
                end += 1;
            }
            // An unfinished comment hides the remaining body, but never changes the file.
            end = if end + 1 < source.len() {
                end + 2
            } else {
                source.len()
            };
            ranges.push(at..end);
            at = end;
        } else {
            at += 1;
        }
    }
    ranges
}

fn escaped(source: &str, at: usize) -> bool {
    source.as_bytes()[..at]
        .iter()
        .rev()
        .take_while(|&&byte| byte == b'\\')
        .count()
        % 2
        == 1
}

fn protected(source: &str) -> Vec<Range<usize>> {
    let parser = Parser::new_ext(source, crate::markdown::options() | Options::ENABLE_MATH);
    let mut ranges: Vec<_> = parser
        .reference_definitions()
        .iter()
        .map(|(_, definition)| definition.span.clone())
        .collect();
    ranges.extend(parser.into_offset_iter().filter_map(|(event, range)| {
        if let Event::Start(Tag::Link { link_type, .. } | Tag::Image { link_type, .. }) = &event {
            let raw = &source[range.clone()];
            return match link_type {
                LinkType::WikiLink { .. } => {
                    let end = raw.find('|').unwrap_or(raw.len());
                    Some(range.start..range.start + end)
                }
                LinkType::Inline => raw.rfind("](").map(|at| range.start + at..range.end),
                LinkType::Autolink | LinkType::Email => Some(range),
                _ => None,
            };
        }
        matches!(
            event,
            Event::Code(_)
                | Event::InlineMath(_)
                | Event::DisplayMath(_)
                | Event::Html(_)
                | Event::InlineHtml(_)
                | Event::Start(Tag::CodeBlock(_))
        )
        .then_some(range)
    }));
    ranges
}

/// Obsidian inline footnotes do not cross a line or occur in code and links.
pub fn inline_footnotes(source: &str) -> Vec<Range<usize>> {
    let mut blocked = protected(source);
    blocked.extend(comments(source));
    blocked.extend(
        Parser::new_ext(source, crate::markdown::options())
            .into_offset_iter()
            .filter_map(|(event, range)| {
                matches!(event, Event::Start(Tag::Link { .. } | Tag::Image { .. })).then_some(range)
            }),
    );
    blocked.sort_by_key(|range| range.start);
    let mut merged: Vec<Range<usize>> = Vec::new();
    for range in blocked {
        if let Some(previous) = merged.last_mut() {
            if range.start <= previous.end {
                previous.end = previous.end.max(range.end);
                continue;
            }
        }
        merged.push(range);
    }
    let bytes = source.as_bytes();
    let mut output = Vec::new();
    let mut at = 0;
    while at + 2 < bytes.len() {
        let protected_index = merged.partition_point(|range| range.end <= at);
        if bytes[at..].starts_with(b"^[")
            && !escaped(source, at)
            && !merged.get(protected_index).is_some_and(|r| r.contains(&at))
        {
            let mut cursor = at + 2;
            let mut depth = 1usize;
            while cursor < bytes.len() && !matches!(bytes[cursor], b'\n' | b'\r') {
                if matches!(bytes[cursor], b'[' | b']') && !escaped(source, cursor) {
                    if bytes[cursor] == b'[' {
                        depth += 1;
                    }
                    if bytes[cursor] == b']' {
                        depth -= 1;
                        if depth == 0 {
                            break;
                        }
                    }
                }
                cursor += 1;
            }
            let boundary = merged.partition_point(|range| range.start < cursor);
            let crosses_protected = boundary > 0
                && merged[boundary - 1].start > at
                && merged[boundary - 1].end > cursor + 1;
            if cursor < bytes.len() && depth == 0 && cursor > at + 2 && !crosses_protected {
                output.push(at..cursor + 1);
                at = cursor + 1;
                continue;
            }
            // Do not repeatedly rescan a long unfinished candidate on the same line.
            at = cursor;
            continue;
        }
        at += 1;
    }
    output
}

pub fn prepare(source: &str) -> String {
    let mut bytes = source.as_bytes().to_vec();
    for range in comments(source) {
        for byte in &mut bytes[range] {
            if !matches!(*byte, b'\n' | b'\r') {
                *byte = b' ';
            }
        }
    }
    // Both delimiters are ASCII and have equal byte length. The ordinary Markdown
    // parser handles nesting while all ranges still address the original buffer.
    let masked = String::from_utf8(bytes).expect("masking preserves UTF-8");
    let protected = protected(&masked);
    let mut bytes = masked.as_bytes().to_vec();
    let mut opening = None;
    let mut delimiters = Vec::new();
    let mut at = 0;
    while at + 1 < bytes.len() {
        if bytes[at..].starts_with(b"\n\n") {
            opening = None;
        }
        if bytes[at..].starts_with(b"==")
            && !escaped(&masked, at)
            && !protected.iter().any(|range| range.contains(&at))
        {
            if let Some(start) = opening.take() {
                bytes[start..start + 2].copy_from_slice(b"**");
                bytes[at..at + 2].copy_from_slice(b"**");
                delimiters.extend([start, at]);
            } else {
                opening = Some(at);
            }
            at += 2;
        } else {
            at += 1;
        }
    }
    let adapted = String::from_utf8(bytes).expect("ASCII replacements preserve UTF-8");
    // Unbalanced Markdown or delimiter collisions must remain literal ==, rather
    // than exposing the temporary ** spelling or changing existing emphasis.
    let mut accepted = std::collections::HashSet::new();
    for (event, range) in
        Parser::new_ext(&adapted, crate::markdown::options() | Options::ENABLE_MATH)
            .into_offset_iter()
    {
        if matches!(event, Event::Start(Tag::Strong))
            && source[range.clone()].starts_with("==")
            && source[range.clone()].ends_with("==")
        {
            accepted.insert(range.start);
            accepted.insert(range.end - 2);
        }
    }
    let mut bytes = adapted.into_bytes();
    for at in delimiters {
        if !accepted.contains(&at) {
            bytes[at..at + 2].copy_from_slice(b"==");
        }
    }
    String::from_utf8(bytes).expect("ASCII replacements preserve UTF-8")
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn reads_template_folder_and_bounded_property_suggestions() -> crate::Result<()> {
        let directory = tempfile::tempdir()?;
        let vault = crate::vault::Vault::open(directory.path())?;
        assert_eq!(template_folder(&vault)?, "Templates");
        fs::create_dir(directory.path().join(".obsidian"))?;
        let settings = directory.path().join(".obsidian/templates.json");
        fs::write(&settings, "\u{feff}{\"folder\":\"Custom\",\"other\":true}")?;
        assert_eq!(template_folder(&vault)?, "Custom");
        fs::write(&settings, "{\"folder\":\"../outside\"}")?;
        assert!(template_folder(&vault).is_err());
        fs::write(&settings, "{\"folder\":\"\"}")?;
        assert_eq!(template_folder(&vault)?, "");
        vault.create_note(
            "One.md",
            "---\nproject: Work\ntags: [one, two]\ncount: 5\n---\nBody",
        )?;
        vault.create_note(
            "Two.md",
            "---\nproject: Work\ncomplex: {nested: true}\n---\nBody",
        )?;
        let suggestions = property_catalog(&vault)?;
        assert_eq!(suggestions.get("project"), Some(&vec!["Work".to_owned()]));
        assert_eq!(
            suggestions.get("tags"),
            Some(&vec!["one".to_owned(), "two".to_owned()])
        );
        assert_eq!(fs::read_to_string(&settings)?, "{\"folder\":\"\"}");
        Ok(())
    }
    #[test]
    fn updates_types_preserving_settings_and_rejecting_stale_changes() -> crate::Result<()> {
        let directory = tempfile::tempdir()?;
        let vault = crate::vault::Vault::open(directory.path())?;
        let types = set_property_type(&vault, "score", "number", &BTreeMap::new())?;
        assert_eq!(types.get("score").map(String::as_str), Some("number"));
        assert!(set_property_type(&vault, "score", "text", &BTreeMap::new()).is_err());
        let path = directory.path().join(".obsidian/types.json");
        fs::write(&path, "\u{feff}{\r\n\"types\":{\"score\":\"number\",\"custom\":\"plugin\"},\"other\":true\r\n}")?;
        let types = property_types(&vault)?;
        set_property_type(&vault, "score", "text", &types)?;
        let saved = fs::read_to_string(&path)?;
        assert!(saved.starts_with('\u{feff}'));
        assert!(saved.contains("\r\n"));
        let value: serde_json::Value = serde_json::from_str(saved.trim_start_matches('\u{feff}'))
            .map_err(|e| crate::Error::Io(e.to_string()))?;
        assert_eq!(value["other"], true);
        assert_eq!(value["types"]["custom"], "plugin");
        assert!(set_property_type(&vault, "../bad", "script", &types).is_err());
        assert!(set_property_type(&vault, "tags", "text", &types).is_err());
        assert_eq!(fs::read_to_string(path)?, saved);
        Ok(())
    }
    #[test]
    fn reads_vault_property_types_without_changing_obsidian_settings() -> crate::Result<()> {
        let directory = tempfile::tempdir()?;
        let vault = crate::vault::Vault::open(directory.path())?;
        assert!(property_types(&vault)?.is_empty());
        fs::create_dir(directory.path().join(".obsidian"))?;
        let path = directory.path().join(".obsidian/types.json");
        let source = r#"{"types":{"created":"datetime","tags":"tags","custom":"plugin-type"},"other":{"unchanged":true}}"#;
        fs::write(&path, source)?;
        let types = property_types(&vault)?;
        assert_eq!(types.get("created").map(String::as_str), Some("datetime"));
        assert_eq!(types.get("custom").map(String::as_str), Some("plugin-type"));
        assert_eq!(fs::read_to_string(&path)?, source);
        fs::write(&path, r#"{"types":{"created":false}}"#)?;
        assert!(property_types(&vault).is_err());
        fs::write(&path, "{broken")?;
        assert!(property_types(&vault).is_err());
        Ok(())
    }
    #[test]
    fn preserves_literals_destinations_and_offsets() {
        let source = "==текст== `%%код%% ==x==` $a == b$ [==label==](a==b.md) [[a==b|==alias==]]\r\n\\%%literal \\==literal\r\n```\r\n%%code%% ==x==\r\n```\r\n";
        let prepared = prepare(source);
        assert_eq!(prepared.len(), source.len());
        assert!(prepared.starts_with("**текст**"));
        for literal in [
            "`%%код%% ==x==`",
            "$a == b$",
            "(a==b.md)",
            "[[a==b|**alias**]]",
            "\\%%literal",
            "\\==literal",
            "%%code%% ==x==",
        ] {
            assert!(prepared.contains(literal), "{literal}: {prepared}");
        }
        assert!(prepared.contains("[**label**]"));
        assert!(comments(source).is_empty());
    }
    #[test]
    fn hides_multiline_and_unfinished_comments_without_moving_following_links() {
        let source = "до %%😀 [[Hidden]]\r\n# скрыто%% после [[Visible]]\n%%unfinished";
        let prepared = prepare(source);
        assert_eq!(prepared.len(), source.len());
        assert_eq!(prepared.find("[[Visible]]"), source.find("[[Visible]]"));
        assert!(!prepared.contains("Hidden"));
        assert!(!prepared.contains("unfinished"));
    }
}
