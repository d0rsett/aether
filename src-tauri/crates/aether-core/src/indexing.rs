use crate::files::revision;
use crate::links::{self, Resolution};
use crate::markdown::{self, ParsedNote, WikiLink};
use crate::vault::{is_link, Vault};
use crate::{Error, Result};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::Duration;
use walkdir::WalkDir;

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IndexStatus {
    pub running: bool,
    pub indexed: usize,
    pub errors: usize,
    pub revision: u64,
    pub message: Option<String>,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchQuery {
    pub text: String,
    pub path: String,
    pub tag: String,
    pub property: String,
    pub value: String,
    pub offset: usize,
}
#[derive(Debug, Serialize)]
pub struct SearchHit {
    pub path: String,
    pub title: String,
    pub snippet: String,
}
#[derive(Debug, Serialize)]
pub struct LinkSuggestion {
    pub path: String,
    pub alias: Option<String>,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchPage {
    pub hits: Vec<SearchHit>,
    pub has_more: bool,
}
#[derive(Debug, Serialize)]
pub struct Backlink {
    pub path: String,
    pub title: String,
    pub line: i64,
    pub mentions: i64,
}
#[derive(Debug, Serialize)]
pub struct Outgoing {
    #[serde(flatten)]
    pub link: WikiLink,
    pub resolution: Resolution,
}
#[derive(Debug, Serialize)]
pub struct Inspection {
    pub metadata: ParsedNote,
    pub backlinks: Vec<Backlink>,
    pub outgoing: Vec<Outgoing>,
}

#[derive(Debug, Serialize)]
pub struct GraphNode {
    pub path: String,
    pub title: String,
}
#[derive(Debug, Serialize)]
pub struct GraphSnapshot {
    pub nodes: Vec<GraphNode>,
    pub edges: Vec<(String, String)>,
}

pub struct Index {
    path: PathBuf,
    version: AtomicU64,
    status: Mutex<IndexStatus>,
}

impl Index {
    pub fn open(path: &Path) -> Result<Self> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let index = Self {
            path: path.into(),
            version: AtomicU64::new(0),
            status: Mutex::new(IndexStatus::default()),
        };
        let mut db = index.connection()?;
        db.execute_batch("PRAGMA journal_mode=WAL;
          CREATE TABLE IF NOT EXISTS notes(id INTEGER PRIMARY KEY,path TEXT NOT NULL UNIQUE,path_key TEXT NOT NULL,stem_key TEXT NOT NULL,title TEXT NOT NULL,body TEXT NOT NULL,revision TEXT NOT NULL,metadata TEXT NOT NULL);
          CREATE INDEX IF NOT EXISTS notes_path_key ON notes(path_key);
          CREATE INDEX IF NOT EXISTS notes_stem_key ON notes(stem_key);
          CREATE TABLE IF NOT EXISTS tags(path TEXT NOT NULL REFERENCES notes(path) ON DELETE CASCADE,tag TEXT NOT NULL,PRIMARY KEY(path,tag));
          CREATE INDEX IF NOT EXISTS tags_tag ON tags(tag);
          CREATE TABLE IF NOT EXISTS links(id INTEGER PRIMARY KEY,source TEXT NOT NULL REFERENCES notes(path) ON DELETE CASCADE,target_stem TEXT NOT NULL,target TEXT NOT NULL,resolved_path TEXT,line INTEGER NOT NULL);
          CREATE INDEX IF NOT EXISTS links_target ON links(resolved_path);
          CREATE INDEX IF NOT EXISTS links_stem ON links(target_stem);
          CREATE INDEX IF NOT EXISTS links_source ON links(source);
          CREATE VIRTUAL TABLE IF NOT EXISTS notes_fts USING fts5(title,body,path,content='notes',content_rowid='id',tokenize='unicode61 remove_diacritics 2');
          CREATE TRIGGER IF NOT EXISTS notes_ai AFTER INSERT ON notes BEGIN INSERT INTO notes_fts(rowid,title,body,path) VALUES(new.id,new.title,new.body,new.path); END;
          CREATE TRIGGER IF NOT EXISTS notes_ad AFTER DELETE ON notes BEGIN INSERT INTO notes_fts(notes_fts,rowid,title,body,path) VALUES('delete',old.id,old.title,old.body,old.path); END;
          CREATE TRIGGER IF NOT EXISTS notes_au AFTER UPDATE ON notes BEGIN INSERT INTO notes_fts(notes_fts,rowid,title,body,path) VALUES('delete',old.id,old.title,old.body,old.path); INSERT INTO notes_fts(rowid,title,body,path) VALUES(new.id,new.title,new.body,new.path); END;")?;
        links::create_aliases(&db)?;
        // Rebuild older disposable caches for comment parsing and YAML aliases,
        // even when note file revisions have not changed.
        let parser_version: u32 = db.pragma_query_value(None, "user_version", |row| row.get(0))?;
        if parser_version < 2 {
            let transaction = db.transaction()?;
            transaction.execute("DELETE FROM notes", [])?;
            transaction.pragma_update(None, "user_version", 2)?;
            transaction.commit()?;
        }
        Ok(index)
    }

    fn connection(&self) -> Result<Connection> {
        let db = Connection::open(&self.path)?;
        db.busy_timeout(Duration::from_secs(2))?;
        db.execute_batch("PRAGMA foreign_keys=ON; PRAGMA synchronous=NORMAL;")?;
        Ok(db)
    }

    pub fn status(&self) -> Result<IndexStatus> {
        self.status
            .lock()
            .map(|value| value.clone())
            .map_err(|_| Error::Index("Индекс занят ошибкой состояния.".into()))
    }
    pub fn failure(&self, error: &Error) {
        if let Ok(mut status) = self.status.lock() {
            status.errors += 1;
            status.message = Some(error.to_string());
            status.running = false;
        }
    }
    fn changed(&self, count: Option<usize>, running: bool) {
        let revision = self.version.fetch_add(1, Ordering::Relaxed) + 1;
        if let Ok(mut status) = self.status.lock() {
            status.running = running;
            status.revision = revision;
            if let Some(count) = count {
                status.indexed = count;
            }
        }
    }

    fn upsert(db: &mut Connection, vault: &Vault, path: &str) -> Result<bool> {
        let note = vault.read_note(path)?;
        let old: Option<String> = db
            .query_row("SELECT revision FROM notes WHERE path=?1", [path], |row| {
                row.get(0)
            })
            .optional()?;
        if old.as_deref() == Some(&note.revision) {
            return Ok(false);
        }
        let mut metadata = markdown::parse(&note.content);
        let body = std::mem::take(&mut metadata.text);
        let title = if metadata.title.is_empty() {
            Path::new(path)
                .file_stem()
                .unwrap_or_default()
                .to_string_lossy()
                .into_owned()
        } else {
            metadata.title.clone()
        };
        let json = serde_json::to_string(&metadata).map_err(|e| Error::Index(e.to_string()))?;
        let transaction = db.transaction()?;
        transaction.execute("INSERT INTO notes(path,path_key,stem_key,title,body,revision,metadata) VALUES(?1,?2,?3,?4,?5,?6,?7) ON CONFLICT(path) DO UPDATE SET title=excluded.title,body=excluded.body,revision=excluded.revision,metadata=excluded.metadata", params![path,links::key(path),links::stem(path),title,body,note.revision,json])?;
        transaction.execute("DELETE FROM tags WHERE path=?1", [path])?;
        transaction.execute("DELETE FROM links WHERE source=?1", [path])?;
        transaction.execute("DELETE FROM aliases WHERE path=?1", [path])?;
        links::insert_aliases(&transaction, path, &metadata)?;
        for tag in metadata.tags {
            transaction.execute(
                "INSERT OR IGNORE INTO tags VALUES(?1,?2)",
                params![path, tag],
            )?;
        }
        for link in metadata.links {
            transaction.execute(
                "INSERT INTO links(source,target_stem,target,line) VALUES(?1,?2,?3,?4)",
                params![
                    path,
                    links::stem(&link.target),
                    link.target,
                    link.line as i64
                ],
            )?;
        }
        transaction.commit()?;
        Ok(true)
    }

    fn refresh_links(db: &Connection, affected: Option<&str>) -> Result<()> {
        let mut statement = db.prepare(
            "SELECT id,source,target FROM links WHERE ?1 IS NULL OR target_stem=?1 OR source=?2",
        )?;
        let rows = statement
            .query_map(params![affected.map(links::stem), affected], |row| {
                Ok((
                    row.get::<_, i64>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                ))
            })?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        drop(statement);
        for (id, source, target) in rows {
            let result = links::resolve(db, &source, &target)?;
            db.execute(
                "UPDATE links SET resolved_path=?1 WHERE id=?2",
                params![result.path, id],
            )?;
        }
        Ok(())
    }

    pub fn scan(&self, vault: &Vault, cancel: &AtomicBool, progress: &dyn Fn()) -> Result<()> {
        self.changed(Some(0), true);
        progress();
        let mut db = self.connection()?;
        let mut found = std::collections::HashSet::new();
        for entry in WalkDir::new(vault.root())
            .follow_links(false)
            .into_iter()
            .filter_entry(|entry| {
                entry.depth() == 0
                    || !entry
                        .file_name()
                        .to_string_lossy()
                        .eq_ignore_ascii_case(".aether")
            })
        {
            if cancel.load(Ordering::Relaxed) {
                return Ok(());
            }
            let entry = match entry {
                Ok(entry) => entry,
                Err(error) => {
                    self.failure(&Error::Index(error.to_string()));
                    continue;
                }
            };
            let metadata = match std::fs::symlink_metadata(entry.path()) {
                Ok(value) => value,
                Err(error) => {
                    self.failure(&error.into());
                    continue;
                }
            };
            if is_link(&metadata) || !metadata.is_file() {
                continue;
            }
            let Ok(relative) = entry.path().strip_prefix(vault.root()) else {
                continue;
            };
            let path = relative.to_string_lossy().replace('\\', "/");
            if vault.note_path(&path).is_err() {
                continue;
            }
            found.insert(path.clone());
            if let Err(error) = Self::upsert(&mut db, vault, &path) {
                self.failure(&error);
            }
            if found.len() % 50 == 0 {
                self.changed(Some(found.len()), true);
                progress();
            }
        }
        let paths = db
            .prepare("SELECT path FROM notes")?
            .query_map([], |row| row.get::<_, String>(0))?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        for path in paths {
            if !found.contains(&path) {
                db.execute("DELETE FROM notes WHERE path=?1", [path])?;
            }
        }
        Self::refresh_links(&db, None)?;
        self.changed(Some(found.len()), false);
        progress();
        Ok(())
    }

    pub fn update(&self, vault: &Vault, path: &str) -> Result<bool> {
        let mut db = self.connection()?;
        let absolute = vault.resolve(path, false)?;
        let changed = if !absolute.exists() {
            if vault.note_path(path).is_ok() {
                db.execute("DELETE FROM notes WHERE path=?1", [path])? > 0
            } else {
                let paths = db
                    .prepare("SELECT path FROM notes")?
                    .query_map([], |row| row.get::<_, String>(0))?
                    .collect::<std::result::Result<Vec<_>, _>>()?;
                let mut changed = false;
                for note in paths {
                    if note.starts_with(&format!("{path}/")) {
                        db.execute("DELETE FROM notes WHERE path=?1", [&note])?;
                        changed = true;
                    }
                }
                changed
            }
        } else if vault.note_path(path).is_ok() {
            Self::upsert(&mut db, vault, path)?
        } else {
            return Ok(false);
        };
        if changed {
            // Alias changes can affect links whose text differs from the filename,
            // including aliases removed by an update or a directory deletion.
            Self::refresh_links(&db, None)?;
            let count =
                db.query_row("SELECT count(*) FROM notes", [], |row| row.get::<_, i64>(0))?;
            self.changed(Some(count as usize), false);
        }
        Ok(changed)
    }

    pub fn update_directory(
        &self,
        vault: &Vault,
        path: &Path,
        cancel: &AtomicBool,
    ) -> Result<bool> {
        let mut changed = false;
        for entry in WalkDir::new(path)
            .follow_links(false)
            .into_iter()
            .filter_entry(|entry| {
                !entry
                    .file_name()
                    .to_string_lossy()
                    .eq_ignore_ascii_case(".aether")
            })
        {
            if cancel.load(Ordering::Relaxed) {
                break;
            }
            let entry = entry.map_err(|error| Error::Index(error.to_string()))?;
            if !entry.file_type().is_file() {
                continue;
            }
            let Ok(relative) = entry.path().strip_prefix(vault.root()) else {
                continue;
            };
            let relative = relative.to_string_lossy().replace('\\', "/");
            if vault.note_path(&relative).is_ok() {
                changed |= self.update(vault, &relative)?;
            }
        }
        Ok(changed)
    }

    pub fn resolve(&self, source: &str, target: &str) -> Result<Resolution> {
        links::resolve(&self.connection()?, source, target)
    }

    pub fn link_suggestions(&self, text: &str) -> Result<Vec<LinkSuggestion>> {
        let db = self.connection()?;
        let query: String = text.trim().to_lowercase().chars().take(256).collect();
        let mut statement = db.prepare("SELECT path,NULL AS alias,CASE WHEN path_key=?2 OR stem_key=?2 THEN 0 ELSE 2 END AS rank FROM notes WHERE instr(path_key,?2)>0 UNION ALL SELECT path,alias,CASE WHEN alias_key=?1 THEN 1 ELSE 3 END AS rank FROM aliases WHERE ?1<>'' AND instr(alias_key,?1)>0 ORDER BY rank,path,alias LIMIT 100")?;
        let mut suggestions = statement
            .query_map(params![query, links::key(&query)], |row| {
                Ok(LinkSuggestion {
                    path: row.get(0)?,
                    alias: row.get(1)?,
                })
            })?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        // Preserve existing title/body search matches alongside filename and
        // alias matches, including names containing punctuation that FTS splits.
        for hit in self
            .search(&SearchQuery {
                text: query,
                ..Default::default()
            })?
            .hits
        {
            if suggestions.len() >= 100 {
                break;
            }
            if !suggestions
                .iter()
                .any(|suggestion| suggestion.path == hit.path && suggestion.alias.is_none())
            {
                suggestions.push(LinkSuggestion {
                    path: hit.path,
                    alias: None,
                });
            }
        }
        Ok(suggestions)
    }

    pub fn graph(&self) -> Result<GraphSnapshot> {
        let mut db = self.connection()?;
        let transaction = db.transaction()?;
        let nodes = transaction
            .prepare("SELECT path,title FROM notes ORDER BY path")?
            .query_map([], |row| {
                Ok(GraphNode {
                    path: row.get(0)?,
                    title: row.get(1)?,
                })
            })?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        let edges = transaction.prepare("SELECT min(l.source,l.resolved_path),max(l.source,l.resolved_path) FROM links l JOIN notes target ON target.path=l.resolved_path WHERE l.source<>l.resolved_path GROUP BY 1,2 ORDER BY 1,2")?
            .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        transaction.commit()?;
        Ok(GraphSnapshot { nodes, edges })
    }

    pub fn inspect(&self, path: &str) -> Result<Inspection> {
        let db = self.connection()?;
        let json: Option<String> = db
            .query_row("SELECT metadata FROM notes WHERE path=?1", [path], |row| {
                row.get(0)
            })
            .optional()?;
        let mut metadata = json
            .map(|s| {
                serde_json::from_str::<ParsedNote>(&s).map_err(|e| Error::Index(e.to_string()))
            })
            .transpose()?
            .unwrap_or_default();
        metadata.links.truncate(100);
        metadata.headings.truncate(200);
        metadata.text.clear();
        let mut outgoing = Vec::new();
        for link in &metadata.links {
            outgoing.push(Outgoing {
                link: link.clone(),
                resolution: links::resolve(&db, path, &link.target)?,
            });
        }
        let backlinks = db.prepare("SELECT notes.path,notes.title,min(links.line),count(*) FROM links JOIN notes ON notes.path=links.source WHERE links.resolved_path=?1 GROUP BY notes.path ORDER BY notes.path LIMIT 100")?.query_map([path],|row| Ok(Backlink { path: row.get(0)?, title: row.get(1)?, line: row.get(2)?, mentions: row.get(3)? }))?.collect::<std::result::Result<Vec<_>,_>>()?;
        Ok(Inspection {
            metadata,
            backlinks,
            outgoing,
        })
    }

    pub fn search(&self, query: &SearchQuery) -> Result<SearchPage> {
        let db = self.connection()?;
        let terms = query
            .text
            .split_whitespace()
            .filter(|term| term.chars().any(char::is_alphanumeric))
            .take(20)
            .map(|term| {
                format!(
                    "\"{}\"*",
                    term.chars()
                        .take(256)
                        .collect::<String>()
                        .replace('"', "\"\"")
                )
            })
            .collect::<Vec<_>>()
            .join(" AND ");
        let path = format!(
            "{}%",
            links::key(&query.path.replace('\\', "/"))
                .replace('\\', "\\\\")
                .replace('%', "\\%")
                .replace('_', "\\_")
        );
        let filters = "notes.path_key LIKE ?2 ESCAPE '\\' AND (?3='' OR EXISTS(SELECT 1 FROM tags WHERE tags.path=notes.path AND tag=?3)) AND (?4='' OR EXISTS(SELECT 1 FROM json_each(notes.metadata,'$.properties') WHERE key=?4 AND CASE type WHEN 'true' THEN 'true' WHEN 'false' THEN 'false' ELSE CAST(value AS TEXT) END=?5))";
        let sql = if terms.is_empty() {
            format!("SELECT notes.path,notes.title,substr(notes.body,1,220) FROM notes WHERE (?1='') AND {filters} ORDER BY notes.path LIMIT 51 OFFSET ?6")
        } else {
            format!("SELECT notes.path,highlight(notes_fts,0,char(1),char(2)),snippet(notes_fts,-1,char(1),char(2),' … ',24) FROM notes_fts JOIN notes ON notes.id=notes_fts.rowid WHERE notes_fts MATCH ?1 AND {filters} ORDER BY bm25(notes_fts,5.0,1.0,4.0),notes.path LIMIT 51 OFFSET ?6")
        };
        let mut hits = db
            .prepare(&sql)?
            .query_map(
                params![
                    terms,
                    path,
                    query.tag.trim_start_matches('#').to_lowercase(),
                    query.property,
                    query.value,
                    query.offset.min(10_000) as i64
                ],
                |row| {
                    Ok(SearchHit {
                        path: row.get(0)?,
                        title: row.get(1)?,
                        snippet: row.get(2)?,
                    })
                },
            )?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        let has_more = hits.len() > 50 && query.offset < 10_000;
        hits.truncate(50);
        Ok(SearchPage { hits, has_more })
    }
}

pub fn cache_name(root: &str) -> String {
    format!("v1-{}.sqlite", revision(root.as_bytes()))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn aliases_resolve_complete_refresh_backlinks_and_migrate_without_writing_notes() -> Result<()>
    {
        let temp = tempfile::tempdir()?;
        let vault = Vault::open(temp.path())?;
        vault.create_directory("Notes")?;
        let content =
            "\u{feff}---\r\naliases: [ИИ, ai, AI, 'C++', '', 42, 'bad|link']\r\n---\r\n# Topic\r\n";
        vault.create_note("Notes/Topic.md", content)?;
        vault.create_note("Ref.md", "[[ии#Part]]\n![[AI]]\n")?;
        let cache = temp.path().join("index.sqlite");
        let index = Index::open(&cache)?;
        index.scan(&vault, &AtomicBool::new(false), &|| {})?;
        assert_eq!(
            index.resolve("Ref.md", "ИИ")?.path.as_deref(),
            Some("Notes/Topic.md")
        );
        assert_eq!(index.inspect("Notes/Topic.md")?.backlinks[0].mentions, 2);
        let suggestions = index.link_suggestions("иИ")?;
        assert_eq!(
            suggestions
                .iter()
                .filter(|item| item.alias.is_some())
                .count(),
            1
        );
        assert_eq!(suggestions[0].alias.as_deref(), Some("ИИ"));
        assert_eq!(
            index.link_suggestions("c+")?[0].alias.as_deref(),
            Some("C++")
        );
        assert_eq!(
            index
                .link_suggestions("ai")?
                .iter()
                .filter(|item| item.alias.is_some())
                .count(),
            1
        );
        assert_eq!(
            index.link_suggestions("Topic.md")?[0].path,
            "Notes/Topic.md"
        );
        assert!(index.link_suggestions("bad")?.is_empty());
        assert!(index.link_suggestions("' OR 1=1--")?.is_empty());
        vault.create_note("Notes/Other.md", "---\naliases:\n  - ИИ\n---\nOther")?;
        index.update(&vault, "Notes/Other.md")?;
        assert_eq!(index.resolve("Ref.md", "ии")?.status, "ambiguous");
        assert_eq!(index.resolve("Ref.md", "ии")?.candidates.len(), 2);
        vault.create_note("ИИ.md", "Real filename")?;
        index.update(&vault, "ИИ.md")?;
        assert_eq!(
            index.resolve("Ref.md", "ии")?.path.as_deref(),
            Some("ИИ.md")
        );
        assert_eq!(index.inspect("ИИ.md")?.backlinks.len(), 1);
        std::fs::remove_file(vault.note_path("ИИ.md")?)?;
        index.update(&vault, "ИИ.md")?;
        std::fs::write(
            vault.note_path("Notes/Other.md")?,
            "---\naliases: New name\n---\nOther",
        )?;
        index.update(&vault, "Notes/Other.md")?;
        assert_eq!(
            index.resolve("Ref.md", "ии")?.path.as_deref(),
            Some("Notes/Topic.md")
        );
        assert_eq!(
            index.resolve("Ref.md", "New name")?.path.as_deref(),
            Some("Notes/Other.md")
        );
        assert_eq!(index.inspect("Notes/Topic.md")?.backlinks[0].mentions, 2);
        let db = index.connection()?;
        db.execute("DELETE FROM aliases", [])?;
        db.pragma_update(None, "user_version", 1)?;
        drop(db);
        drop(index);
        let index = Index::open(&cache)?;
        index.scan(&vault, &AtomicBool::new(false), &|| {})?;
        assert_eq!(
            index.resolve("Ref.md", "ai")?.path.as_deref(),
            Some("Notes/Topic.md")
        );
        assert_eq!(vault.read_note("Notes/Topic.md")?.content, content);
        std::fs::remove_dir_all(vault.resolve("Notes", false)?)?;
        index.update(&vault, "Notes")?;
        assert_eq!(index.resolve("Ref.md", "ai")?.status, "missing");
        assert!(index
            .link_suggestions("ИИ")?
            .iter()
            .all(|item| item.alias.is_none()));
        Ok(())
    }
    #[test]
    fn legacy_cached_comments_are_reparsed_without_changing_notes() -> Result<()> {
        let temp = tempfile::tempdir()?;
        let root = temp.path().join("vault");
        std::fs::create_dir(&root)?;
        let vault = Vault::open(&root)?;
        let source = "Visible\n\n%%Secretword [[Hidden]] #hidden%%\n";
        vault.create_note("Note.md", source)?;
        let path = temp.path().join("index.sqlite");
        let index = Index::open(&path)?;
        index.scan(&vault, &AtomicBool::new(false), &|| {})?;
        let db = index.connection()?;
        db.execute("UPDATE notes SET body='Secretword'", [])?;
        db.pragma_update(None, "user_version", 0)?;
        drop(db);
        drop(index);
        let index = Index::open(&path)?;
        index.scan(&vault, &AtomicBool::new(false), &|| {})?;
        assert!(index
            .search(&SearchQuery {
                text: "Secretword".into(),
                ..Default::default()
            })?
            .hits
            .is_empty());
        assert_eq!(
            index
                .search(&SearchQuery {
                    text: "Visible".into(),
                    ..Default::default()
                })?
                .hits
                .len(),
            1
        );
        assert_eq!(vault.read_note("Note.md")?.content, source);
        Ok(())
    }
    #[test]
    fn filename_unicode_path_boolean_property_and_quoted_input() -> Result<()> {
        let temp = tempfile::tempdir()?;
        let root = temp.path().join("vault");
        std::fs::create_dir(&root)?;
        let vault = Vault::open(&root)?;
        vault.create_directory("Проекты")?;
        vault.create_note(
            "Проекты/ИМЯ_ФАЙЛА.md",
            "---\nactive: true\n---\n# Другой заголовок\nСодержимое",
        )?;
        let index = Index::open(&temp.path().join("index.sqlite"))?;
        index.scan(&vault, &AtomicBool::new(false), &|| {})?;
        let hits = index.search(&SearchQuery {
            text: "имя".into(),
            path: "проекты/".into(),
            property: "active".into(),
            value: "true".into(),
            ..Default::default()
        })?;
        assert_eq!(hits.hits.len(), 1);
        assert!(index
            .search(&SearchQuery {
                text: "\" OR 1=1--".into(),
                ..Default::default()
            })
            .is_ok());
        assert!(index
            .inspect("Проекты/ИМЯ_ФАЙЛА.md")?
            .metadata
            .text
            .is_empty());
        Ok(())
    }
    #[test]
    fn fts_russian_english_filters_and_incremental_backlinks() -> Result<()> {
        let temp = tempfile::tempdir()?;
        let root = temp.path().join("vault");
        std::fs::create_dir(&root)?;
        let vault = Vault::open(&root)?;
        vault.create_note(
            "Начало.md",
            "---\ntags: [работа]\nstatus: draft\n---\n# Начало\nПривет knowledge [[Цель|Другая]] [[Цель|Ещё имя]]\n[[Цель]]",
        )?;
        let target = vault.create_note("Цель.md", "# Цель\nВторая заметка")?;
        let index = Index::open(&temp.path().join("index.sqlite"))?;
        index.scan(&vault, &AtomicBool::new(false), &|| {})?;
        assert_eq!(
            index
                .search(&SearchQuery {
                    text: "прив".into(),
                    ..SearchQuery::default()
                })?
                .hits
                .len(),
            1
        );
        assert_eq!(
            index
                .search(&SearchQuery {
                    text: "know".into(),
                    tag: "работа".into(),
                    property: "status".into(),
                    value: "draft".into(),
                    ..SearchQuery::default()
                })?
                .hits[0]
                .path,
            "Начало.md"
        );
        assert_eq!(index.inspect("Цель.md")?.backlinks[0].path, "Начало.md");
        assert_eq!(index.inspect("Цель.md")?.backlinks[0].mentions, 3);
        vault.rename_note("Цель.md", "Новая.md", &target.revision)?;
        index.update(&vault, "Цель.md")?;
        index.update(&vault, "Новая.md")?;
        assert_eq!(
            index.inspect("Начало.md")?.outgoing[0].resolution.status,
            "missing"
        );
        vault.create_note("Цель.md", "# Вернулась")?;
        index.update(&vault, "Цель.md")?;
        assert_eq!(index.inspect("Цель.md")?.backlinks.len(), 1);
        assert!(!index.update(&vault, "Цель.md")?);
        Ok(())
    }
    #[test]
    fn graph_includes_all_links_and_deduplicates_resolved_aliases() -> Result<()> {
        let temp = tempfile::tempdir()?;
        let root = temp.path().join("vault");
        std::fs::create_dir(&root)?;
        let vault = Vault::open(&root)?;
        let mut source = String::from("[[Alias]] [[Target]] [[Main]] [[Missing]] ");
        vault.create_note("Target.md", "---\naliases: [Alias]\n---\n[[Main]]")?;
        for number in 0..120 {
            let path = format!("N{number}.md");
            vault.create_note(&path, "")?;
            source.push_str(&format!("[[N{number}]] "));
        }
        vault.create_note("Main.md", &source)?;
        vault.create_note("Orphan.md", "")?;
        let index = Index::open(&temp.path().join("index.sqlite"))?;
        index.scan(&vault, &AtomicBool::new(false), &|| {})?;
        let graph = index.graph()?;
        assert_eq!(graph.nodes.len(), 123);
        assert_eq!(graph.edges.len(), 121);
        assert!(graph
            .edges
            .contains(&("Main.md".into(), "Target.md".into())));
        assert!(!graph
            .edges
            .iter()
            .any(|(a, b)| a == b || a == "Missing.md" || b == "Missing.md"));
        let target = vault.read_note("Target.md")?;
        vault.trash_note("Target.md", &target.revision)?;
        index.update(&vault, "Target.md")?;
        assert_eq!(index.graph()?.edges.len(), 120);
        Ok(())
    }
}
