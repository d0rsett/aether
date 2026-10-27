//! Offset-preserving adaptations of Obsidian's inline syntax.
use pulldown_cmark::{Event, LinkType, Options, Parser, Tag};
use std::ops::Range;

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
