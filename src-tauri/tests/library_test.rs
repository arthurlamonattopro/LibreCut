use std::fs;
use std::path::{Path, PathBuf};

use librecut_lib::library::{
    atomic_write, list_projects, read_cache, read_document, remove_all, remove_project,
    sanitize_id, store_document, summary_from_document,
};
use serde_json::{json, Value};

struct TempDir(PathBuf);

impl TempDir {
    fn new(label: &str) -> Self {
        let dir = std::env::temp_dir().join(format!(
            "librecut-library-{label}-{}",
            uuid::Uuid::new_v4().simple()
        ));
        fs::create_dir_all(&dir).expect("create temp dir");
        Self(dir)
    }

    fn path(&self) -> &Path {
        &self.0
    }
}

impl Drop for TempDir {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

fn document(name: &str) -> Value {
    json!({
        "schemaVersion": 1,
        "id": "project",
        "name": name,
        "width": 1920,
        "height": 1080,
        "fps": 30,
        "createdAt": 1000,
        "updatedAt": 2000,
        "assets": [],
        "tracks": [
            { "id": "t1", "clips": [
                { "id": "c1", "start": 0.0, "duration": 4.0 },
                { "id": "c2", "start": 10.0, "duration": 2.5 }
            ] }
        ]
    })
}

/// A document edited at a different time, so the library can order it.
fn document_at(name: &str, updated_at: i64) -> Value {
    let mut value = document(name);
    value["updatedAt"] = json!(updated_at);
    value
}

fn cache() -> Value {
    json!({ "assets": { "a1": { "thumbnails": ["data:image/jpeg;base64,AAA"], "waveform": [0.1] } } })
}

#[test]
fn summary_is_built_from_the_document() {
    let summary = summary_from_document("project", &document("My project"));
    assert_eq!(summary.id, "project");
    assert_eq!(summary.name, "My project");
    assert_eq!(summary.width, 1920);
    assert_eq!(summary.height, 1080);
    assert_eq!(summary.fps, 30.0);
    assert_eq!(summary.created_at, 1000);
    assert_eq!(summary.updated_at, 2000);
    // The duration is the end of the last clip.
    assert_eq!(summary.duration, 12.5);
}

#[test]
fn summary_handles_a_project_without_clips() {
    let summary = summary_from_document("project", &json!({ "name": "Empty" }));
    assert_eq!(summary.name, "Empty");
    assert_eq!(summary.duration, 0.0);
}

#[test]
fn a_stored_document_can_be_read_back() {
    let dir = TempDir::new("read-back");
    let summary = store_document(
        dir.path(),
        "project",
        &document("Round trip").to_string(),
        None,
        None,
    )
    .expect("store");

    assert_eq!(summary.name, "Round trip");
    let raw = read_document(dir.path(), "project")
        .expect("read")
        .expect("a document");
    let parsed: Value = serde_json::from_str(&raw).expect("parse");
    assert_eq!(parsed["name"], "Round trip");
}

#[test]
fn the_media_cache_is_stored_next_to_the_document() {
    let dir = TempDir::new("cache");
    store_document(
        dir.path(),
        "project",
        &document("With cache").to_string(),
        Some(&cache().to_string()),
        None,
    )
    .expect("store");

    let raw = read_cache(dir.path(), "project")
        .expect("read")
        .expect("a cache");
    assert!(raw.contains("thumbnails"));
}

#[test]
fn the_media_cache_is_left_alone_when_it_is_not_supplied() {
    let dir = TempDir::new("cache-kept");
    store_document(
        dir.path(),
        "project",
        &document("First").to_string(),
        Some(&cache().to_string()),
        None,
    )
    .expect("store");
    store_document(
        dir.path(),
        "project",
        &document("Second").to_string(),
        None,
        None,
    )
    .expect("store again");

    // A plain edit must not throw the media cache away.
    assert!(read_cache(dir.path(), "project").expect("read").is_some());
}

#[test]
fn a_truncated_document_falls_back_to_the_backup() {
    let dir = TempDir::new("truncated");
    let path = dir.path().join("project").join("project.json");

    // The backup holds the previous good document, so a second save is
    // needed before there is something to fall back to.
    store_document(
        dir.path(),
        "project",
        &document("Good").to_string(),
        None,
        None,
    )
    .expect("store");
    store_document(
        dir.path(),
        "project",
        &document("Newer").to_string(),
        None,
        None,
    )
    .expect("store again");
    fs::write(&path, "{ not json").expect("corrupt");

    let raw = read_document(dir.path(), "project")
        .expect("read")
        .expect("a document");
    assert!(raw.contains("Good"));
}

#[test]
fn the_backup_holds_the_previous_document() {
    let dir = TempDir::new("backup");
    let path = dir.path().join("project.json");

    atomic_write(&path, &document("First").to_string()).expect("write first");
    atomic_write(&path, &document("Second").to_string()).expect("write second");

    let backup = fs::read_to_string(path.with_extension("bak")).expect("read backup");
    assert!(backup.contains("First"));

    // The temp file must not survive a completed write.
    assert!(!path.with_extension("tmp").exists());
}

#[test]
fn the_library_lists_the_stored_projects() {
    let dir = TempDir::new("list");
    store_document(
        dir.path(),
        "one",
        &document_at("One", 1000).to_string(),
        None,
        Some("poster".to_string()),
    )
    .expect("store");
    store_document(
        dir.path(),
        "two",
        &document_at("Two", 2000).to_string(),
        None,
        None,
    )
    .expect("store");

    let projects = list_projects(dir.path());
    assert_eq!(projects.len(), 2);
    // The most recently edited project comes first.
    assert_eq!(projects[0].name, "Two");
    assert_eq!(projects[1].name, "One");
    assert_eq!(projects[1].thumbnail.as_deref(), Some("poster"));
}

#[test]
fn deleting_a_project_removes_its_files() {
    let dir = TempDir::new("delete");
    store_document(
        dir.path(),
        "project",
        &document("Doomed").to_string(),
        Some(&cache().to_string()),
        None,
    )
    .expect("store");

    remove_project(dir.path(), "project").expect("remove");

    assert!(read_document(dir.path(), "project")
        .expect("read")
        .is_none());
    assert!(read_cache(dir.path(), "project").expect("read").is_none());
    assert!(list_projects(dir.path()).is_empty());
}

#[test]
fn clearing_removes_every_project() {
    let dir = TempDir::new("clear");
    store_document(dir.path(), "one", &document("One").to_string(), None, None).expect("store");
    store_document(dir.path(), "two", &document("Two").to_string(), None, None).expect("store");

    remove_all(dir.path()).expect("clear");

    assert!(list_projects(dir.path()).is_empty());
    assert!(read_document(dir.path(), "one").expect("read").is_none());
}

#[test]
fn a_project_id_cannot_escape_the_library() {
    assert!(sanitize_id("../escape").is_err());
    assert!(sanitize_id("with/slash").is_err());
    assert!(sanitize_id("").is_err());
    assert_eq!(sanitize_id("good-id_1").expect("valid"), "good-id_1");
}
