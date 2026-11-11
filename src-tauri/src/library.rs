use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::{AppHandle, Manager};

/// Summary of a stored project. The library index keeps one entry per
/// project so the project list never has to open every document.
#[derive(Serialize, Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct StoredProjectSummary {
    pub id: String,
    pub name: String,
    pub width: u32,
    pub height: u32,
    pub fps: f64,
    pub created_at: i64,
    pub updated_at: i64,
    pub duration: f64,
    /// Poster frame for the project library, kept separate from the document.
    pub thumbnail: Option<String>,
}

/// Project ids become folder names, so only a conservative character set is
/// allowed through.
pub fn sanitize_id(id: &str) -> Result<String, String> {
    let trimmed = id.trim();
    if trimmed.is_empty() || trimmed.len() > 96 {
        return Err("Invalid project id.".to_string());
    }
    if !trimmed
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
    {
        return Err("Invalid project id.".to_string());
    }
    Ok(trimmed.to_string())
}

/// Writes a file so a reader never observes a partial document: the new
/// content lands in a temp file first, the previous copy is kept as `.bak`,
/// and the temp file is renamed into place.
pub fn atomic_write(path: &Path, contents: &str) -> Result<(), String> {
    let temp = path.with_extension("tmp");
    std::fs::write(&temp, contents)
        .map_err(|error| format!("Could not write {}: {error}", path.display()))?;
    if path.is_file() {
        let _ = std::fs::copy(path, path.with_extension("bak"));
    }
    std::fs::rename(&temp, path)
        .map_err(|error| format!("Could not finalize {}: {error}", path.display()))?;
    Ok(())
}

pub fn read_index(root: &Path) -> Vec<StoredProjectSummary> {
    let Ok(raw) = std::fs::read_to_string(root.join("index.json")) else {
        return Vec::new();
    };
    serde_json::from_str(&raw).unwrap_or_default()
}

fn write_index(root: &Path, entries: &[StoredProjectSummary]) -> Result<(), String> {
    let serialized = serde_json::to_string(entries)
        .map_err(|error| format!("Could not encode the project index: {error}"))?;
    atomic_write(&root.join("index.json"), &serialized)
}

fn upsert_index(root: &Path, summary: StoredProjectSummary) -> Result<(), String> {
    let mut entries = read_index(root);
    entries.retain(|entry| entry.id != summary.id);
    entries.push(summary);
    write_index(root, &entries)
}

fn number(value: Option<&Value>) -> f64 {
    value.and_then(Value::as_f64).unwrap_or(0.0)
}

fn integer(value: Option<&Value>) -> i64 {
    value.and_then(Value::as_i64).unwrap_or(0)
}

/// Builds the library entry from the stored document so the index never drifts
/// from the data on disk.
pub fn summary_from_document(id: &str, document: &Value) -> StoredProjectSummary {
    let mut duration = 0.0_f64;
    if let Some(tracks) = document.get("tracks").and_then(Value::as_array) {
        for track in tracks {
            let Some(clips) = track.get("clips").and_then(Value::as_array) else {
                continue;
            };
            for clip in clips {
                let end = number(clip.get("start")) + number(clip.get("duration"));
                if end > duration {
                    duration = end;
                }
            }
        }
    }
    StoredProjectSummary {
        id: id.to_string(),
        name: document
            .get("name")
            .and_then(Value::as_str)
            .unwrap_or("Untitled project")
            .to_string(),
        width: number(document.get("width")) as u32,
        height: number(document.get("height")) as u32,
        fps: number(document.get("fps")),
        created_at: integer(document.get("createdAt")),
        updated_at: integer(document.get("updatedAt")),
        duration,
        thumbnail: None,
    }
}

/// Stores the editable part of a project inside `root`.
///
/// The document excludes regenerable media caches (thumbnails and waveforms),
/// so an autosave of a long timeline stays small enough to serialize without
/// stalling the editor. `cache` is written only when it is supplied, which
/// happens after an import rather than on every edit.
pub fn store_document(
    root: &Path,
    id: &str,
    document: &str,
    cache: Option<&str>,
    thumbnail: Option<String>,
) -> Result<StoredProjectSummary, String> {
    let parsed: Value = serde_json::from_str(document)
        .map_err(|error| format!("Refusing to save invalid project data: {error}"))?;
    let mut summary = summary_from_document(id, &parsed);
    summary.thumbnail = thumbnail.filter(|value| !value.is_empty());

    let dir = root.join(sanitize_id(id)?);
    std::fs::create_dir_all(&dir)
        .map_err(|error| format!("Could not create the project folder: {error}"))?;
    atomic_write(&dir.join("project.json"), document)?;
    if let Some(cache) = cache {
        serde_json::from_str::<Value>(cache)
            .map_err(|error| format!("Refusing to save invalid media cache data: {error}"))?;
        atomic_write(&dir.join("cache.json"), cache)?;
    }
    upsert_index(root, summary.clone())?;
    Ok(summary)
}

/// Reads a project document. A truncated or corrupted file falls back to the
/// previous good copy, so a crash during a save does not lose the project.
pub fn read_document(root: &Path, id: &str) -> Result<Option<String>, String> {
    let dir = root.join(sanitize_id(id)?);
    for candidate in ["project.json", "project.bak"] {
        let Ok(raw) = std::fs::read_to_string(dir.join(candidate)) else {
            continue;
        };
        if serde_json::from_str::<Value>(&raw).is_ok() {
            return Ok(Some(raw));
        }
    }
    Ok(None)
}

/// Reads the regenerable media caches of a project.
pub fn read_cache(root: &Path, id: &str) -> Result<Option<String>, String> {
    let dir = root.join(sanitize_id(id)?);
    let Ok(raw) = std::fs::read_to_string(dir.join("cache.json")) else {
        return Ok(None);
    };
    if serde_json::from_str::<Value>(&raw).is_err() {
        return Ok(None);
    }
    Ok(Some(raw))
}

/// Removes a project and its media caches.
pub fn remove_project(root: &Path, id: &str) -> Result<(), String> {
    let dir = root.join(sanitize_id(id)?);
    let _ = std::fs::remove_dir_all(&dir);
    let entries: Vec<StoredProjectSummary> = read_index(root)
        .into_iter()
        .filter(|entry| entry.id != id)
        .collect();
    write_index(root, &entries)
}

/// Removes every stored project.
pub fn remove_all(root: &Path) -> Result<(), String> {
    if let Ok(entries) = std::fs::read_dir(root) {
        for entry in entries.flatten() {
            if entry.path().is_dir() {
                let _ = std::fs::remove_dir_all(entry.path());
            }
        }
    }
    write_index(root, &[])
}

/// Lists the stored projects, most recently edited first.
pub fn list_projects(root: &Path) -> Vec<StoredProjectSummary> {
    let mut entries = read_index(root);
    entries.sort_by_key(|entry| std::cmp::Reverse(entry.updated_at));
    entries
}

fn projects_root(app: &AppHandle) -> Result<PathBuf, String> {
    let root = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("Could not locate the app data folder: {error}"))?
        .join("projects");
    std::fs::create_dir_all(&root)
        .map_err(|error| format!("Could not create the project store: {error}"))?;
    Ok(root)
}

/// Stores the editable part of a project.
#[tauri::command]
pub async fn save_project_document(
    app: AppHandle,
    id: String,
    document: String,
    cache: Option<String>,
    thumbnail: Option<String>,
) -> Result<StoredProjectSummary, String> {
    let root = projects_root(&app)?;
    store_document(&root, &id, &document, cache.as_deref(), thumbnail)
}

/// Reads a stored project document, or null when it is missing.
#[tauri::command]
pub async fn load_project_document(app: AppHandle, id: String) -> Result<Option<String>, String> {
    read_document(&projects_root(&app)?, &id)
}

/// Reads the regenerable media caches of a stored project.
#[tauri::command]
pub async fn load_project_cache(app: AppHandle, id: String) -> Result<Option<String>, String> {
    read_cache(&projects_root(&app)?, &id)
}

/// Lists the stored projects, most recently edited first.
#[tauri::command]
pub async fn list_project_states(app: AppHandle) -> Result<Vec<StoredProjectSummary>, String> {
    Ok(list_projects(&projects_root(&app)?))
}

/// Removes a project and its media caches.
#[tauri::command]
pub async fn delete_project_state(app: AppHandle, id: String) -> Result<(), String> {
    remove_project(&projects_root(&app)?, &id)
}

/// Removes every stored project.
#[tauri::command]
pub async fn clear_project_states(app: AppHandle) -> Result<(), String> {
    remove_all(&projects_root(&app)?)
}

/// Writes a profiling report into the app data folder and returns its path.
///
/// Reports are plain JSON and use the same atomic write as the project
/// documents, so a report captured during a crash is still readable.
#[tauri::command]
pub async fn write_diagnostics_report(
    app: AppHandle,
    name: String,
    contents: String,
) -> Result<String, String> {
    let safe_name: String = name
        .trim()
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '-' || c == '_' {
                c
            } else {
                '-'
            }
        })
        .collect();
    if safe_name.is_empty() {
        return Err("Invalid report name.".to_string());
    }
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("Could not locate the app data folder: {error}"))?
        .join("reports");
    std::fs::create_dir_all(&dir)
        .map_err(|error| format!("Could not create the report folder: {error}"))?;
    let target = dir.join(format!("{safe_name}.json"));
    atomic_write(&target, &contents)?;
    Ok(target.to_string_lossy().to_string())
}
