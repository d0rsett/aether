use pulldown_cmark::{Event, HeadingLevel, LinkType, Options, Parser, Tag, TagEnd};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use std::collections::BTreeSet;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WikiLink {
    pub target: String,
    pub alias: Option<String>,
    pub anchor: Option<String>,
    pub embedded: bool,
    pub line: usize,
    #[serde(default)]
    pub start: usize,
    #[serde(default)]
    pub end: usize,
    #[serde(default)]
    pub target_start: usize,
    #[serde(default)]
    pub target_end: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Heading {
    pub title: String,
    pub level: u8,
    pub line: usize,
    #[serde(default)]
    pub start: usize,
    #[serde(default)]
    pub end: usize,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct ParsedNote {
    pub title: String,
    pub text: String,
    pub tags: Vec<String>,
    pub properties: Map<String, Value>,
    pub headings: Vec<Heading>,
    pub links: Vec<WikiLink>,
    pub warning: Option<String>,
    #[serde(default)]
    pub body_offset: usize,
}

pub fn options() -> Options {
    Options::ENABLE_TABLES
        | Options::ENABLE_TASKLISTS
        | Options::ENABLE_FOOTNOTES
        | Options::ENABLE_STRIKETHROUGH
        | Options::ENABLE_WIKILINKS
}

pub fn parse(content: &str) -> ParsedNote {
    let mut note = ParsedNote::default();
    let text = content.strip_prefix('\u{feff}').unwrap_or(content);
    let bom = content.len() - text.len();
    let mut offset = bom;
    if text.starts_with("---\n") || text.starts_with("---\r\n") {
        let first = text.find('\n').map_or(0, |at| at + 1);
        let mut end = first;
        for line in text[first..].split_inclusive('\n') {
            let start = end;
            end += line.len();
            if matches!(line.trim(), "---" | "...") {
                offset = end + bom;
                if start - first > 65_536 {
                    note.warning =
                        Some("Frontmatter превышает 64 КБ; свойства не разобраны.".into());
                } else {
                    match serde_yaml_ng::from_str::<Value>(&text[first..start]) {
                        Ok(Value::Object(properties)) => note.properties = properties,
                        Ok(Value::Null) => {}
                        Ok(_) => {
                            note.warning = Some("Frontmatter должен быть YAML mapping.".into())
                        }
                        Err(error) => note.warning = Some(format!("Ошибка YAML: {error}")),
                    }
                }
                break;
            }
        }
    }
    let mut tags = BTreeSet::new();
    if let Some(value) = note.properties.get("tags") {
        let values = match value {
            Value::Array(values) => values.clone(),
            value => vec![value.clone()],
        };
        for value in values {
            if let Some(value) = value.as_str() {
                for tag in value.split([',', ' ']).filter(|s| !s.is_empty()) {
                    tags.insert(tag.trim_start_matches('#').to_lowercase());
                }
            }
        }
    }
    note.body_offset = offset;
    let body = &content[offset..];
    let mut heading: Option<Heading> = None;
    let mut code_block = false;
    let mut link_label: Option<(usize, String)> = None;
    let newlines: Vec<usize> = content
        .match_indices('\n')
        .map(|(offset, _)| offset)
        .collect();
    for (event, range) in Parser::new_ext(body, options()).into_offset_iter() {
        let line = || newlines.partition_point(|at| *at < offset + range.start) + 1;
        let prose = matches!(&event, Event::Text(_));
        match event {
            Event::Start(Tag::Heading { level, .. }) => {
                let level = match level {
                    HeadingLevel::H1 => 1,
                    HeadingLevel::H2 => 2,
                    HeadingLevel::H3 => 3,
                    HeadingLevel::H4 => 4,
                    HeadingLevel::H5 => 5,
                    HeadingLevel::H6 => 6,
                };
                heading = Some(Heading {
                    title: String::new(),
                    level,
                    line: line(),
                    start: offset + range.start,
                    end: offset + range.end,
                });
            }
            Event::End(TagEnd::Heading(_)) => {
                if let Some(mut value) = heading.take() {
                    value.end = offset + range.end;
                    if note.title.is_empty() && value.level == 1 {
                        note.title = value.title.clone();
                    }
                    note.headings.push(value);
                }
                note.text.push('\n');
            }
            Event::Start(Tag::CodeBlock(_)) => code_block = true,
            Event::End(TagEnd::CodeBlock) => {
                code_block = false;
                note.text.push('\n');
            }
            Event::Start(Tag::Link {
                link_type: LinkType::WikiLink { has_pothole },
                dest_url,
                ..
            })
            | Event::Start(Tag::Image {
                link_type: LinkType::WikiLink { has_pothole },
                dest_url,
                ..
            }) => {
                let raw = dest_url.as_ref();
                let (target, anchor) =
                    raw.split_once('#').map_or((raw, None), |(target, anchor)| {
                        (target, Some(anchor.to_owned()))
                    });
                let embedded = body[range.clone()].starts_with('!');
                let raw_link = &body[range.clone()];
                let open = if embedded { 3 } else { 2 };
                let mut escaped = false;
                let mut target_end = raw_link.len().saturating_sub(2);
                for (at, ch) in raw_link[open..].char_indices() {
                    if escaped {
                        escaped = false;
                        continue;
                    }
                    if ch == '\\' {
                        escaped = true;
                        continue;
                    }
                    if matches!(ch, '#' | '|' | ']') {
                        target_end = open + at;
                        break;
                    }
                }
                let target_raw = &raw_link[open..target_end];
                let leading = target_raw.len() - target_raw.trim_start().len();
                let target_start = offset + range.start + open + leading;
                note.links.push(WikiLink {
                    target: target.trim().into(),
                    anchor,
                    alias: None,
                    embedded,
                    line: line(),
                    start: offset + range.start,
                    end: offset + range.end,
                    target_start,
                    target_end: target_start + target_raw.trim().len(),
                });
                if has_pothole {
                    link_label = Some((note.links.len() - 1, String::new()));
                }
            }
            Event::End(TagEnd::Link | TagEnd::Image) => {
                if let Some((index, label)) = link_label.take() {
                    note.links[index].alias = Some(label);
                }
            }
            Event::Text(value) | Event::Code(value) => {
                note.text.push_str(&value);
                note.text.push(' ');
                if let Some(heading) = &mut heading {
                    heading.title.push_str(&value);
                }
                if let Some((_, label)) = &mut link_label {
                    label.push_str(&value);
                }
                if !code_block && prose {
                    for word in value.split_whitespace() {
                        if let Some(tag) = word.trim_start_matches(['(', '[']).strip_prefix('#') {
                            let tag: String = tag
                                .chars()
                                .take_while(|c| c.is_alphanumeric() || matches!(c, '_' | '-' | '/'))
                                .collect();
                            if !tag.is_empty() {
                                tags.insert(tag.to_lowercase());
                            }
                        }
                    }
                }
            }
            Event::SoftBreak | Event::HardBreak | Event::End(TagEnd::Paragraph) => {
                note.text.push('\n')
            }
            _ => {}
        }
    }
    if let Some(title) = note.properties.get("title").and_then(Value::as_str) {
        note.title = title.into();
    }
    note.tags = tags.into_iter().filter(|tag| !tag.is_empty()).collect();
    note
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn parses_yaml_cyrillic_tags_wiki_and_skips_code() {
        let note = parse("---\r\ntitle: Мысли\r\ntags: [Работа, rust]\r\nstatus: draft\r\n---\r\n# Заголовок\r\n[[Папка/Заметка#Раздел|Имя]] ![[Картинка]] #Идеи\r\n`[[не ссылка]] #не-тег`\r\n```md\r\n[[тоже не ссылка]] #no\r\n```\r\n");
        assert_eq!(note.title, "Мысли");
        assert_eq!(note.links.len(), 2);
        assert_eq!(note.links[0].target, "Папка/Заметка");
        assert_eq!(note.links[0].alias.as_deref(), Some("Имя"));
        assert_eq!(note.links[0].anchor.as_deref(), Some("Раздел"));
        assert!(note.links[1].embedded);
        assert_eq!(note.tags, ["rust", "идеи", "работа"]);
        assert_eq!(note.headings[0].line, 6);
        assert_eq!(note.properties["status"], "draft");
    }
    #[test]
    fn malformed_yaml_does_not_hide_markdown_or_panic() {
        let note = parse("---\ntags: [\n---\n# Доступный текст\n[[#^block]]");
        assert!(note.warning.is_some());
        assert_eq!(note.title, "Доступный текст");
        assert_eq!(note.links[0].anchor.as_deref(), Some("^block"));
    }
}
