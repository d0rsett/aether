use crate::markdown;
use crate::{Error, Result};
use pulldown_cmark::{Event, Parser, Tag, TagEnd};
use serde::Serialize;
use std::collections::{HashMap, HashSet};
use std::ops::Range;

#[derive(Debug, Clone, Serialize)]
pub struct Location {
    pub from: usize,
    pub to: usize,
    pub line: usize,
}

pub fn decode(value: &str) -> String {
    let bytes = value.as_bytes();
    let mut output = Vec::new();
    let mut at = 0;
    while at < bytes.len() {
        if bytes[at] == b'%' && at + 2 < bytes.len() {
            let digit = |byte: u8| (byte as char).to_digit(16);
            if let (Some(a), Some(b)) = (digit(bytes[at + 1]), digit(bytes[at + 2])) {
                output.push((a * 16 + b) as u8);
                at += 3;
                continue;
            }
        }
        output.push(bytes[at]);
        at += 1;
    }
    String::from_utf8(output).unwrap_or_else(|_| value.into())
}
fn name(value: &str) -> String {
    value
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .to_lowercase()
}
fn slug(value: &str) -> String {
    value
        .to_lowercase()
        .chars()
        .filter(|ch| ch.is_alphanumeric() || ch.is_whitespace() || matches!(ch, '-' | '_'))
        .collect::<String>()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join("-")
}
fn location(content: &str, range: Range<usize>) -> Location {
    let units = |byte: usize| content[..byte].replace("\r\n", "\n").encode_utf16().count();
    Location {
        from: units(range.start),
        to: units(range.end),
        line: content[..range.start]
            .bytes()
            .filter(|b| *b == b'\n')
            .count()
            + 1,
    }
}

pub fn locate(content: &str, anchor: &str) -> Result<Location> {
    let anchor = decode(anchor.trim().trim_start_matches('#'));
    let parsed = markdown::parse(content);
    if let Some(id) = anchor.strip_prefix('^') {
        if id.is_empty()
            || !id
                .chars()
                .all(|ch| ch.is_alphanumeric() || matches!(ch, '-' | '_'))
        {
            return Err(Error::Navigation("Недопустимый ID блока.".into()));
        }
        let marker = format!("^{id}");
        let mut candidates = Vec::new();
        let mut offset = 0;
        for line in content.split_inclusive('\n') {
            let trimmed = line.trim_end();
            if let Some(prefix) = trimmed.strip_suffix(&marker) {
                if (prefix.is_empty() || prefix.ends_with(char::is_whitespace))
                    && offset >= parsed.body_offset
                {
                    candidates.push((offset + prefix.len(), prefix.trim().is_empty()));
                }
            }
            offset += line.len();
        }
        let mut stack: Vec<(TagEnd, Range<usize>)> = Vec::new();
        let mut completed: Option<Range<usize>> = None;
        let mut code = false;
        let mut found = Vec::new();
        let mut seen = HashSet::new();
        for (event, range) in
            Parser::new_ext(&content[parsed.body_offset..], markdown::options()).into_offset_iter()
        {
            let absolute = range.start + parsed.body_offset..range.end + parsed.body_offset;
            match event {
                Event::Start(tag) => {
                    if matches!(tag, Tag::CodeBlock(_)) {
                        code = true;
                    }
                    if matches!(
                        tag,
                        Tag::Paragraph
                            | Tag::Heading { .. }
                            | Tag::CodeBlock(_)
                            | Tag::Item
                            | Tag::List(_)
                            | Tag::BlockQuote(_)
                            | Tag::Table(_)
                    ) {
                        stack.push((tag.to_end(), absolute));
                    }
                }
                Event::End(tag) => {
                    if tag == TagEnd::CodeBlock {
                        code = false;
                    }
                    if stack.last().is_some_and(|(end, _)| *end == tag) {
                        completed = stack.pop().map(|(_, range)| range);
                    }
                }
                Event::Text(_) if !code => {
                    for (at, standalone) in &candidates {
                        if absolute.contains(at) && seen.insert(*at) {
                            let current = stack
                                .last()
                                .map(|(_, range)| range.clone())
                                .unwrap_or(absolute.clone());
                            found.push(if *standalone {
                                completed.clone().unwrap_or(current)
                            } else {
                                current
                            });
                        }
                    }
                }
                _ => {}
            }
        }
        return match found.len() {
            1 => Ok(location(content, found.remove(0))),
            0 => Err(Error::Navigation(format!(
                "Блок ^{id} не найден в заметке."
            ))),
            _ => Err(Error::Navigation(format!(
                "ID ^{id} повторяется; укажите уникальный ID блока."
            ))),
        };
    }
    if anchor.is_empty() {
        return Ok(Location {
            from: 0,
            to: 0,
            line: 1,
        });
    }
    if let Some(heading) = parsed
        .headings
        .iter()
        .find(|heading| name(&heading.title) == name(&anchor))
    {
        return Ok(location(content, heading.start..heading.end));
    }
    let mut duplicates = HashMap::<String, usize>::new();
    for heading in parsed.headings {
        let base = slug(&heading.title);
        let count = duplicates.entry(base.clone()).or_default();
        let candidate = if *count == 0 {
            base
        } else {
            format!("{base}-{}", *count)
        };
        *count += 1;
        if candidate == anchor.to_lowercase() {
            return Ok(location(content, heading.start..heading.end));
        }
    }
    Err(Error::Navigation(format!(
        "Заголовок «{anchor}» не найден в заметке."
    )))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn formatted_headings_utf16_crlf_bom_and_duplicate_slugs() -> Result<()> {
        let text = "\u{feff}😀 вступление\r\n# **Раздел** один\r\nтекст\r\n# Раздел один\r\n";
        let first = locate(text, "Раздел%20один")?;
        assert_eq!(first.line, 2);
        assert_eq!(first.from, 15);
        assert_eq!(locate(text, "раздел-один-1")?.line, 4);
        assert_eq!(locate("\u{feff}# Начало\n", "Начало")?.from, 1);
        Ok(())
    }
    #[test]
    fn blocks_inline_standalone_and_exclusions() -> Result<()> {
        let text="---\nexample: ^hidden\n---\n# Заголовок\n\nПервый абзац\nпродолжение ^one\n\nВторой абзац\n\n^two\n\n```\n^code\n```\n\n`^inline`\n\n\\^escaped\n";
        assert_eq!(locate(text, "^one")?.line, 6);
        assert_eq!(locate(text, "^two")?.line, 9);
        for id in ["^hidden", "^code", "^inline", "^escaped", "^missing"] {
            assert!(locate(text, id).is_err(), "{id}");
        }
        assert!(locate("A ^dup\n\nB ^dup\n", "^dup").is_err());
        Ok(())
    }
}
