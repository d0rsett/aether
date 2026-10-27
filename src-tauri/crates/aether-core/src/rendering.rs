//! A library-parsed, inert document tree. The UI never receives executable note HTML.
use crate::{markdown, Error, Result};
use pulldown_cmark::{CodeBlockKind, Event, LinkType, Parser, Tag};
use serde::Serialize;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Node {
    pub from: usize,
    pub to: usize,
    pub kind: String,
    pub text: String,
    pub target: String,
    pub has_alias: bool,
    pub level: u64,
    pub line: usize,
    pub end_line: usize,
    pub children: Vec<Node>,
}
#[derive(Serialize)]
pub struct Document {
    pub nodes: Vec<Node>,
    pub warning: Option<String>,
}

pub fn render(content: &str) -> Result<Document> {
    if content.len() > 4 * 1024 * 1024 {
        return Err(Error::Navigation(
            "Для просмотра заметок больше 4 МБ используйте исходный режим.".into(),
        ));
    }
    let metadata = markdown::parse(content);
    // CodeMirror counts UTF-16 and treats CRLF as a single line separator.
    let mut positions = vec![0; content.len() + 1];
    let mut units = 0;
    for (byte, ch) in content.char_indices() {
        positions[byte..byte + ch.len_utf8()].fill(units);
        if ch != '\r' || content.as_bytes().get(byte + 1) != Some(&b'\n') {
            units += ch.len_utf16();
        }
    }
    positions[content.len()] = units;
    let offset = metadata.body_offset;
    let lines: Vec<_> = content.match_indices('\n').map(|(at, _)| at).collect();
    let line = |at: usize| lines.partition_point(|n| *n < at) + 1;
    let mut root = Vec::new();
    let mut stack: Vec<Node> = Vec::new();
    let mut count = 0;
    for (event, range) in Parser::new_ext(
        &content[offset..],
        markdown::options() | pulldown_cmark::Options::ENABLE_MATH,
    )
    .into_offset_iter()
    {
        count += 1;
        if count > 100_000 || stack.len() > 64 {
            return Err(Error::Navigation(
                "Слишком сложная заметка для просмотра. Исходный режим остаётся доступен.".into(),
            ));
        }
        let mut node = Node {
            from: positions[offset + range.start],
            to: positions[offset + range.end],
            kind: String::new(),
            text: String::new(),
            has_alias: false,
            target: String::new(),
            level: 0,
            line: line(offset + range.start),
            end_line: line(offset + range.end.saturating_sub(1)),
            children: Vec::new(),
        };
        match event {
            Event::Start(tag) => {
                node.kind = match tag {
                    Tag::Paragraph => "paragraph",
                    Tag::Heading { level, .. } => {
                        node.level = level as u64;
                        "heading"
                    }
                    Tag::BlockQuote(_) => "quote",
                    Tag::CodeBlock(kind) => {
                        if let CodeBlockKind::Fenced(info) = kind {
                            node.target = info.split_whitespace().next().unwrap_or("").into();
                        }
                        "codeBlock"
                    }
                    Tag::List(start) => {
                        node.level = start.unwrap_or(0);
                        if start.is_some() {
                            "orderedList"
                        } else {
                            "list"
                        }
                    }
                    Tag::Item => "item",
                    Tag::Emphasis => "emphasis",
                    Tag::Strong => "strong",
                    Tag::Strikethrough => "strike",
                    Tag::Link {
                        link_type,
                        dest_url,
                        title,
                        ..
                    }
                    | Tag::Image {
                        link_type,
                        dest_url,
                        title,
                        ..
                    } => {
                        node.target = dest_url.into_string();
                        node.has_alias =
                            matches!(link_type, LinkType::WikiLink { has_pothole: true });
                        node.text = title.into_string();
                        let image = content[offset + range.start..].starts_with('!');
                        match (image, matches!(link_type, LinkType::WikiLink { .. })) {
                            (false, true) => "wiki",
                            (true, true) => "embed",
                            (true, false) => "image",
                            _ => "link",
                        }
                    }
                    Tag::Table(_) => "table",
                    Tag::TableHead => "tableHead",
                    Tag::TableRow => "tableRow",
                    Tag::TableCell => "tableCell",
                    Tag::FootnoteDefinition(id) => {
                        node.target = id.into_string();
                        "footnote"
                    }
                    _ => "group",
                }
                .into();
                stack.push(node);
                continue;
            }
            Event::End(_) => {
                let Some(completed) = stack.pop() else {
                    continue;
                };
                node = completed;
            }
            Event::Text(value) => {
                node.kind = "text".into();
                node.text = value.into_string();
            }
            Event::Code(value) => {
                node.kind = "code".into();
                node.text = value.into_string();
            }
            Event::Html(value) | Event::InlineHtml(value) => {
                node.kind = "literalHtml".into();
                node.text = value.into_string();
            }
            Event::InlineMath(value) => {
                node.kind = "math".into();
                node.text = value.into_string();
            }
            Event::DisplayMath(value) => {
                node.level = 1;
                node.kind = "math".into();
                node.text = value.into_string();
            }
            Event::SoftBreak => {
                node.kind = "text".into();
                node.text = "\n".into();
            }
            Event::HardBreak => node.kind = "break".into(),
            Event::Rule => node.kind = "rule".into(),
            Event::TaskListMarker(checked) => {
                node.kind = "task".into();
                node.level = u64::from(checked);
            }
            Event::FootnoteReference(id) => {
                node.kind = "footnoteRef".into();
                node.target = id.into_string();
            }
        }
        if let Some(parent) = stack.last_mut() {
            parent.children.push(node);
        } else {
            root.push(node);
        }
    }
    Ok(Document {
        nodes: root,
        warning: metadata.warning,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    fn flatten(nodes: &[Node]) -> Vec<&Node> {
        nodes
            .iter()
            .flat_map(|n| std::iter::once(n).chain(flatten(&n.children)))
            .collect()
    }
    #[test]
    fn commonmark_gfm_math_and_inert_html_share_library_parser() -> Result<()> {
        let doc=render("\u{feff}---\r\ntitle: Title\r\n---\r\n# **Title**\r\n\n- [x] Done\n\n| A | B |\n|---|---|\n| 1 | 2 |\n\n[[Note#Heading|Alias]] ![[image.png]]\n\n$x^2$\n\n<script>alert(1)</script>\n")?;
        assert_eq!(doc.nodes[0].kind, "heading");
        assert_eq!(doc.nodes[0].line, 4);
        let all = flatten(&doc.nodes);
        for kind in [
            "strong",
            "task",
            "table",
            "wiki",
            "embed",
            "math",
            "literalHtml",
        ] {
            assert!(all.iter().any(|n| n.kind == kind), "{kind}");
        }
        assert!(all
            .iter()
            .any(|n| n.kind == "wiki" && n.target == "Note#Heading"));
        assert!(all.iter().any(|n| n.kind == "wiki" && n.has_alias));
        assert!(all.iter().any(|n| n.kind == "embed" && !n.has_alias));
        Ok(())
    }
    #[test]
    fn preview_ranges_match_utf16_normalized_document_with_bom_crlf_and_emoji() -> Result<()> {
        let text="\u{feff}# 😀\r\n\r\n$$x^2$$\r\n\r\n![Рисунок](image.png)\r\n\r\n| A | B |\r\n|---|---|\r\n| 1 | 2 |\r\n";
        let normalized = text.replace("\r\n", "\n");
        let units: Vec<_> = normalized.encode_utf16().collect();
        let doc = render(text)?;
        let all = flatten(&doc.nodes);
        for (kind, expected) in [
            ("math", "$$x^2$$"),
            ("image", "![Рисунок](image.png)"),
            ("table", "| A | B |"),
        ] {
            let node = all
                .iter()
                .find(|node| node.kind == kind)
                .ok_or_else(|| Error::Navigation("missing node".into()))?;
            let source = String::from_utf16(&units[node.from..node.to])
                .map_err(|e| Error::Navigation(e.to_string()))?;
            assert!(source.starts_with(expected), "{kind}: {source}");
        }
        Ok(())
    }
}
