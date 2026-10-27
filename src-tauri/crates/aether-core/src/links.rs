use crate::Result;
use rusqlite::{params, Connection};
use serde::Serialize;

pub fn create_aliases(db: &Connection) -> Result<()> {
    db.execute_batch("CREATE TABLE IF NOT EXISTS aliases(path TEXT NOT NULL REFERENCES notes(path) ON DELETE CASCADE,alias TEXT NOT NULL,alias_key TEXT NOT NULL,PRIMARY KEY(path,alias_key)); CREATE INDEX IF NOT EXISTS aliases_key ON aliases(alias_key);")?;
    Ok(())
}

pub fn aliases(note: &crate::markdown::ParsedNote) -> Vec<String> {
    let values: Vec<_> = match note.properties.get("aliases") {
        Some(serde_json::Value::Array(values)) => {
            values.iter().filter_map(|value| value.as_str()).collect()
        }
        Some(serde_json::Value::String(value)) => vec![value.as_str()],
        _ => Vec::new(),
    };
    let mut seen = std::collections::HashSet::new();
    values
        .into_iter()
        .map(str::trim)
        .filter(|value| {
            !value.is_empty()
                && !value.contains(['[', ']', '|', '#'])
                && !value.chars().any(char::is_control)
                && seen.insert(value.to_lowercase())
        })
        .map(str::to_owned)
        .collect()
}

pub fn insert_aliases(
    db: &Connection,
    path: &str,
    note: &crate::markdown::ParsedNote,
) -> Result<()> {
    for alias in aliases(note) {
        db.execute(
            "INSERT OR IGNORE INTO aliases(path,alias,alias_key) VALUES(?1,?2,?3)",
            params![path, alias, alias.to_lowercase()],
        )?;
    }
    Ok(())
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Resolution {
    pub status: String,
    pub path: Option<String>,
    pub candidates: Vec<String>,
    pub create_path: Option<String>,
}

pub fn key(path: &str) -> String {
    let value = path.to_lowercase();
    value
        .strip_suffix(".markdown")
        .or_else(|| value.strip_suffix(".md"))
        .unwrap_or(&value)
        .to_owned()
}
pub fn stem(path: &str) -> String {
    key(path.rsplit('/').next().unwrap_or(path))
}

fn normalize(base: &str, target: &str) -> Option<String> {
    let mut parts: Vec<&str> = base.split('/').filter(|s| !s.is_empty()).collect();
    if target.starts_with('/') || target.contains(['\\', ':']) {
        return None;
    }
    for part in target.split('/') {
        match part {
            "" | "." => {}
            ".." => {
                parts.pop()?;
            }
            value => parts.push(value),
        }
    }
    Some(parts.join("/"))
}

fn matches(db: &Connection, column: &str, value: &str) -> Result<Vec<String>> {
    // Column is selected by this module, never by user input.
    let sql = format!("SELECT path FROM notes WHERE {column}=?1 ORDER BY path LIMIT 101");
    let mut statement = db.prepare(&sql)?;
    let values = statement
        .query_map(params![value], |row| row.get(0))?
        .collect::<std::result::Result<Vec<String>, _>>()?;
    Ok(values)
}

pub fn resolve(db: &Connection, source: &str, target: &str) -> Result<Resolution> {
    let target = target.split('#').next().unwrap_or(target).trim();
    if target.is_empty() {
        return Ok(Resolution {
            status: "resolved".into(),
            path: Some(source.into()),
            candidates: vec![],
            create_path: None,
        });
    }
    let directory = source.rsplit_once('/').map_or("", |(parent, _)| parent);
    let local = normalize(directory, target);
    let root = normalize("", target);
    let candidates = if target.starts_with("./") || target.starts_with("../") {
        vec![local.clone()]
    } else {
        vec![root, local.clone()]
    };
    for candidate in candidates.into_iter().flatten() {
        let found = matches(db, "path_key", &key(&candidate))?;
        if !found.is_empty() {
            return Ok(result(found));
        }
    }
    if !target.contains('/') {
        let found = matches(db, "stem_key", &stem(target))?;
        if !found.is_empty() {
            return Ok(result(found));
        }
        let found = db
            .prepare(
                "SELECT DISTINCT path FROM aliases WHERE alias_key=?1 ORDER BY path LIMIT 101",
            )?
            .query_map([target.to_lowercase()], |row| row.get::<_, String>(0))?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        if !found.is_empty() {
            return Ok(result(found));
        }
    }
    let create_path = local.map(|path| {
        if path.to_lowercase().ends_with(".md") || path.to_lowercase().ends_with(".markdown") {
            path
        } else {
            format!("{path}.md")
        }
    });
    Ok(Resolution {
        status: "missing".into(),
        path: None,
        candidates: vec![],
        create_path,
    })
}

fn result(candidates: Vec<String>) -> Resolution {
    if candidates.len() == 1 {
        Resolution {
            status: "resolved".into(),
            path: candidates.first().cloned(),
            candidates: vec![],
            create_path: None,
        }
    } else {
        Resolution {
            status: "ambiguous".into(),
            path: None,
            candidates,
            create_path: None,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn resolves_unicode_relative_unique_and_ambiguous_names() -> Result<()> {
        let db = Connection::open_in_memory()?;
        db.execute_batch("CREATE TABLE notes(path TEXT PRIMARY KEY,path_key TEXT,stem_key TEXT);")?;
        create_aliases(&db)?;
        for path in ["Мысли.md", "A/Одна.md", "B/Одна.md", "B/Уникальная.md"]
        {
            db.execute(
                "INSERT INTO notes VALUES(?1,?2,?3)",
                params![path, key(path), stem(path)],
            )?;
        }
        assert_eq!(
            resolve(&db, "A/Текущая.md", "МЫСЛИ")?.path.as_deref(),
            Some("Мысли.md")
        );
        assert_eq!(resolve(&db, "C/Текущая.md", "Одна")?.status, "ambiguous");
        assert_eq!(
            resolve(&db, "A/Текущая.md", "Одна")?.path.as_deref(),
            Some("A/Одна.md")
        );
        assert_eq!(
            resolve(&db, "A/Текущая.md", "../B/Уникальная#Раздел")?
                .path
                .as_deref(),
            Some("B/Уникальная.md")
        );
        assert!(resolve(&db, "Текущая.md", "../../escape")?
            .create_path
            .is_none());
        Ok(())
    }
}
