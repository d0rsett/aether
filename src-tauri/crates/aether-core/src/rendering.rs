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

/// Render against the entire document first so reference-style links retain
/// definitions outside the selected fragment. Ranges use normalized UTF-16.
pub fn fragment(content: &str, anchor: &str) -> Result<Document> {
    let mut document = render_tree(content)?;
    let raw_anchor = anchor.trim().trim_start_matches('#');
    let anchor = crate::navigation::decode(raw_anchor);
    if !anchor.is_empty() {
        let location = crate::navigation::locate(content, raw_anchor)?;
        let end = if anchor.starts_with('^') {
            location.to
        } else {
            fn headings(nodes: &[Node], output: &mut Vec<(usize, u64)>) {
                for node in nodes {
                    if node.kind == "heading" {
                        output.push((node.from, node.level));
                    }
                    headings(&node.children, output);
                }
            }
            let mut outline = Vec::new();
            headings(&document.nodes, &mut outline);
            let level = outline
                .iter()
                .find(|(from, _)| *from == location.from)
                .map(|(_, level)| *level)
                .ok_or_else(|| Error::Navigation("Раздел не найден в заметке.".into()))?;
            outline
                .iter()
                .filter(|(from, next)| *from > location.from && *next <= level)
                .map(|(from, _)| *from)
                .min()
                .unwrap_or(usize::MAX)
        };
        fn clip(mut node: Node, from: usize, to: usize) -> Option<Node> {
            if node.to <= from || node.from >= to {
                return None;
            }
            if node.from < from || node.to > to {
                node.children = node
                    .children
                    .into_iter()
                    .filter_map(|child| clip(child, from, to))
                    .collect();
                if node.children.is_empty() {
                    return None;
                }
            }
            Some(node)
        }
        document.nodes = document
            .nodes
            .into_iter()
            .filter_map(|node| clip(node, location.from, end))
            .collect();
        if let Some(id) = anchor.strip_prefix('^') {
            fn hide_marker(nodes: &mut [Node], marker: &str) {
                for node in nodes {
                    if matches!(node.kind.as_str(), "code" | "codeBlock" | "math") {
                        continue;
                    }
                    if node.kind == "text" {
                        if let Some(prefix) = node.text.trim_end().strip_suffix(marker) {
                            if prefix.is_empty() || prefix.ends_with(char::is_whitespace) {
                                node.text = prefix.trim_end().into();
                            }
                        }
                    }
                    hide_marker(&mut node.children, marker);
                }
            }
            hide_marker(&mut document.nodes, &format!("^{id}"));
        }
    }
    limit_embeds(&mut document.nodes, &mut 0);
    Ok(document)
}

pub fn render(content: &str) -> Result<Document> {
    let mut document = render_tree(content)?;
    limit_embeds(&mut document.nodes, &mut 0);
    Ok(document)
}

fn render_tree(content: &str) -> Result<Document> {
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
    let prepared = crate::obsidian::prepare(&content[offset..]);
    for (event, range) in Parser::new_ext(
        &prepared,
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
                    Tag::Strong => {
                        if content[offset + range.start..].starts_with("==") {
                            "highlight"
                        } else {
                            "strong"
                        }
                    }
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
                if node.kind == "quote" {
                    callout(&mut node);
                }
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
                node.text = content[offset + range.start..offset + range.end].into();
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
    for range in crate::obsidian::comments(&content[offset..]) {
        root.push(Node {
            from: positions[offset + range.start],
            to: positions[offset + range.end],
            kind: "comment".into(),
            text: String::new(),
            target: String::new(),
            has_alias: false,
            level: 0,
            line: line(offset + range.start),
            end_line: line(offset + range.end),
            children: Vec::new(),
        });
    }

    Ok(Document {
        nodes: root,
        warning: metadata.warning,
    })
}

fn limit_embeds(nodes: &mut [Node], count: &mut usize) {
    for node in nodes {
        if node.kind == "embed" {
            let path = node.target.split('#').next().unwrap_or("");
            let extension = path.rsplit('.').next().unwrap_or("").to_ascii_lowercase();
            if !matches!(
                extension.as_str(),
                "png"
                    | "jpg"
                    | "jpeg"
                    | "gif"
                    | "webp"
                    | "svg"
                    | "bmp"
                    | "pdf"
                    | "mp3"
                    | "wav"
                    | "ogg"
                    | "m4a"
                    | "flac"
                    | "3gp"
                    | "mp4"
                    | "webm"
                    | "mov"
                    | "mkv"
                    | "ogv"
                    | "canvas"
                    | "txt"
                    | "csv"
                    | "docx"
                    | "xlsx"
                    | "pptx"
                    | "zip"
            ) {
                *count += 1;
                if *count > 32 {
                    node.kind = "embedLimit".into();
                }
            }
        }
        limit_embeds(&mut node.children, count);
    }
}

fn callout(node: &mut Node) {
    let Some(paragraph) = node
        .children
        .first_mut()
        .filter(|child| child.kind == "paragraph")
    else {
        return;
    };
    let prefix_count = paragraph
        .children
        .iter()
        .take_while(|child| child.kind == "text" && !child.text.contains('\n'))
        .count();
    let prefix: String = paragraph.children[..prefix_count]
        .iter()
        .map(|child| child.text.as_str())
        .collect();
    let Some(rest) = prefix.strip_prefix("[!") else {
        return;
    };
    let Some((kind, tail)) = rest.split_once(']') else {
        return;
    };
    if kind.is_empty()
        || !kind
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || ch == '-')
    {
        return;
    }
    let mode = tail.chars().next().filter(|ch| matches!(ch, '+' | '-'));
    node.kind = "callout".into();
    node.target = kind.to_ascii_lowercase();
    node.level = match mode {
        Some('-') => 2,
        Some('+') => 1,
        _ => 0,
    };
    let title = if mode.is_some() { &tail[1..] } else { tail };
    // Soft breaks are distinct text nodes; the first line is the title.
    node.text = title.trim().to_owned();
    paragraph.children.drain(..prefix_count);
    let title_count = paragraph
        .children
        .iter()
        .take_while(|child| child.text != "\n" && child.kind != "break")
        .count();
    let title_nodes = paragraph.children.drain(..title_count).collect();
    if paragraph
        .children
        .first()
        .is_some_and(|child| child.text == "\n")
    {
        paragraph.children.remove(0);
    }
    // Preserve formatted title content in its own inert node.
    let mut title_node = Node {
        from: node.from,
        to: node.to,
        kind: "calloutTitle".into(),
        text: node.text.clone(),
        target: String::new(),
        has_alias: false,
        level: 0,
        line: node.line,
        end_line: node.line,
        children: title_nodes,
    };
    if title_node.text.is_empty() && title_node.children.is_empty() {
        title_node.text = node.target.clone();
    }
    node.children.insert(0, title_node);
}

#[cfg(test)]
mod tests {
    use super::*;
    fn plain(nodes: &[Node]) -> String {
        nodes
            .iter()
            .map(|node| format!("{}{}", node.text, plain(&node.children)))
            .collect()
    }
    #[test]
    fn embeds_heading_subsections_and_preserves_external_reference_definitions() -> Result<()> {
        let source = "\u{feff}---\r\ntitle: Metadata\r\n---\r\n# Начало 😀\r\nВступление\r\n## **Раздел**\r\nВыбрано [ссылка][ref]\r\n### Вложенный\r\nЕщё текст\r\n## Следующий\r\nНе показывать\r\n\r\n[ref]: ../Other.md\r\n";
        let doc = fragment(source, "Раздел")?;
        let output = plain(&doc.nodes);
        assert!(output.contains("Выбрано"));
        assert!(output.contains("Вложенный"));
        assert!(!output.contains("Вступление"));
        assert!(!output.contains("Не показывать"));
        assert!(flatten(&doc.nodes)
            .iter()
            .any(|node| node.kind == "link" && node.target == "../Other.md"));
        assert!(
            plain(&fragment(source, "Начало%20😀#Раздел#Вложенный")?.nodes).contains("Ещё текст")
        );
        assert!(
            !plain(&fragment(source, "Начало%20😀#Раздел#Вложенный")?.nodes).contains("Выбрано")
        );
        assert!(fragment(source, "Missing").is_err());
        Ok(())
    }
    #[test]
    fn embeds_blocks_and_lists_without_ids_or_neighboring_content() -> Result<()> {
        let source = "Первый\n\nАбзац **жирный** 😀 ^paragraph\n\n- Выбранный ^item\n- Соседний\n\n- Один\n- Два\n\n^list\n\nПоследний\n";
        let paragraph = plain(&fragment(source, "^paragraph")?.nodes);
        assert!(paragraph.contains("Абзац"));
        assert!(!paragraph.contains("^paragraph"));
        assert!(!paragraph.contains("Первый"));
        let item = plain(&fragment(source, "^item")?.nodes);
        assert!(item.contains("Выбранный"));
        assert!(!item.contains("Соседний"));
        let list = plain(&fragment(source, "^list")?.nodes);
        assert!(list.contains("Один") && list.contains("Два"));
        assert!(!list.contains("Последний"));
        assert!(fragment("A ^dup\n\nB ^dup\n", "^dup").is_err());
        assert!(fragment("%%\nHidden ^secret\n%%", "^secret").is_err());
        Ok(())
    }
    #[test]
    fn limits_note_embeds_after_selecting_the_requested_section() -> Result<()> {
        let source = format!(
            "# Many\n{}\n# Selected\n![[Final]]\n",
            "![[Note]]\n\n".repeat(40)
        );
        let full = render(&source)?;
        assert_eq!(
            flatten(&full.nodes)
                .iter()
                .filter(|node| node.kind == "embed")
                .count(),
            32
        );
        assert!(flatten(&full.nodes)
            .iter()
            .any(|node| node.kind == "embedLimit"));
        let selected = fragment(&source, "Selected")?;
        assert!(flatten(&selected.nodes)
            .iter()
            .any(|node| node.kind == "embed" && node.target == "Final"));
        Ok(())
    }
    #[test]
    fn obsidian_inline_syntax_and_nested_callouts_preserve_source() -> Result<()> {
        let source = "# 😀\r\n\r\n==важно **жирно**== и `==код== %%код%%`\r\n\r\n%%секрет [[Hidden]] #hidden\r\nскрыто%%\r\n\r\n> [!warning]- **Внимание**\r\n> Текст ==важно==\r\n>\r\n> > [!tip] Совет\r\n> > - [ ] Сделать\r\n";
        let document = render(source)?;
        let all = flatten(&document.nodes);
        assert!(all.iter().any(|node| node.kind == "highlight"));
        assert!(all.iter().any(|node| node.kind == "strong"));
        assert_eq!(all.iter().filter(|node| node.kind == "callout").count(), 2);
        assert!(all
            .iter()
            .any(|node| node.kind == "callout" && node.target == "warning" && node.level == 2));
        assert!(!all
            .iter()
            .any(|node| node.kind == "wiki" && node.target == "Hidden"));
        assert!(!all.iter().any(|node| node.text.contains("секрет")));
        let normalized = source.replace("\r\n", "\n");
        let units: Vec<_> = normalized.encode_utf16().collect();
        let task = all.iter().find(|node| node.kind == "task").expect("task");
        assert_eq!(String::from_utf16_lossy(&units[task.from..task.to]), "[ ]");
        assert_eq!(task.text, "[ ]");
        assert!(flatten(&render(&source.replace("[ ]", "[x]"))?.nodes)
            .iter()
            .any(|node| node.kind == "task" && node.level == 1));
        let parsed = markdown::parse(source);
        assert!(!parsed.text.contains("секрет"));
        assert!(!parsed.tags.iter().any(|tag| tag == "hidden"));
        assert!(parsed.links.is_empty());
        Ok(())
    }
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
