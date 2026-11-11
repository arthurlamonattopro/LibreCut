use std::fs;
use std::path::{Path, PathBuf};

use serde::Serialize;
use tauri::http::{Request, Response, StatusCode};
use tauri::{AppHandle, Manager, Runtime};

#[derive(Serialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct OfflineModelStatus {
    pub available: bool,
    pub root: String,
    pub resource_root: Option<String>,
    pub models: Vec<String>,
}

fn app_models_root<R: Runtime>(app: &AppHandle<R>) -> Option<PathBuf> {
    app.path()
        .app_data_dir()
        .ok()
        .map(|path| path.join("models"))
}

fn resource_models_root<R: Runtime>(app: &AppHandle<R>) -> Option<PathBuf> {
    app.path()
        .resource_dir()
        .ok()
        .map(|path| path.join("models"))
}

fn is_model_dir(path: &Path) -> bool {
    if path.join("config.json").is_file() || path.join("tokenizer.json").is_file() {
        return true;
    }
    let Ok(entries) = fs::read_dir(path) else {
        return false;
    };
    entries.flatten().any(|entry| {
        entry
            .path()
            .extension()
            .and_then(|extension| extension.to_str())
            .map(|extension| extension.eq_ignore_ascii_case("onnx"))
            .unwrap_or(false)
    })
}

fn collect_models(root: &Path, current: &Path, prefix: &Path, models: &mut Vec<String>) {
    let Ok(entries) = fs::read_dir(current) else {
        return;
    };
    let mut entries: Vec<_> = entries.flatten().collect();
    entries.sort_by_key(|entry| entry.path());
    for entry in entries {
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        let Ok(relative) = path.strip_prefix(root) else {
            continue;
        };
        let id = relative.to_string_lossy().replace('\\', "/");
        if is_model_dir(&path) {
            models.push(id);
        } else if prefix.components().count() < 4 {
            collect_models(root, &path, prefix, models);
        }
    }
}

fn scan(root: &Path) -> Vec<String> {
    let mut models = Vec::new();
    if root.is_dir() {
        collect_models(root, root, Path::new(""), &mut models);
    }
    models.sort();
    models.dedup();
    models
}

#[tauri::command]
pub fn offline_model_status<R: Runtime>(app: AppHandle<R>) -> OfflineModelStatus {
    let root = app_models_root(&app).unwrap_or_default();
    let resource = resource_models_root(&app);
    let mut models = scan(&root);
    if let Some(resource_root) = resource.as_ref() {
        if resource_root != &root {
            models.extend(scan(resource_root));
        }
    }
    models.sort();
    models.dedup();
    OfflineModelStatus {
        available: !models.is_empty(),
        root: root.to_string_lossy().to_string(),
        resource_root: resource.map(|path| path.to_string_lossy().to_string()),
        models,
    }
}

#[tauri::command]
pub fn ensure_models_dir<R: Runtime>(app: AppHandle<R>) -> Result<String, String> {
    let root = app_models_root(&app).ok_or("Could not locate the application data folder")?;
    fs::create_dir_all(&root)
        .map_err(|error| format!("Could not create models folder: {error}"))?;
    Ok(root.to_string_lossy().to_string())
}

fn mime_for(path: &Path) -> &'static str {
    match path
        .extension()
        .and_then(|extension| extension.to_str())
        .unwrap_or("")
        .to_ascii_lowercase()
        .as_str()
    {
        "json" => "application/json",
        "txt" => "text/plain; charset=utf-8",
        "wasm" => "application/wasm",
        "onnx" | "bin" | "model" => "application/octet-stream",
        "html" => "text/html; charset=utf-8",
        _ => "application/octet-stream",
    }
}

fn common_headers(response: tauri::http::response::Builder) -> tauri::http::response::Builder {
    response
        .header("Access-Control-Allow-Origin", "*")
        .header("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS")
        .header("Access-Control-Allow-Headers", "*")
        .header("Cache-Control", "public, max-age=3600")
}

fn not_found() -> Response<Vec<u8>> {
    common_headers(Response::builder().status(StatusCode::NOT_FOUND))
        .body(Vec::new())
        .unwrap()
}

/// Serves model files from the user's model folder, falling back to a bundled
/// resource folder. Request paths are relative to the models root, for example
/// `Xenova/whisper-small/config.json`.
pub fn handle_protocol<R: Runtime>(
    app: &AppHandle<R>,
    request: &Request<Vec<u8>>,
) -> Response<Vec<u8>> {
    if request.method() == tauri::http::Method::OPTIONS {
        return common_headers(Response::builder().status(StatusCode::NO_CONTENT))
            .body(Vec::new())
            .unwrap();
    }

    let decoded = percent_encoding::percent_decode_str(request.uri().path())
        .decode_utf8_lossy()
        .to_string();
    let relative = decoded.trim_start_matches('/');
    if relative.is_empty()
        || relative
            .split('/')
            .any(|part| part == ".." || part.contains('\\'))
    {
        return not_found();
    }

    let mut roots: Vec<PathBuf> = Vec::new();
    if let Some(root) = app_models_root(app) {
        roots.push(root);
    }
    if let Some(root) = resource_models_root(app) {
        if !roots.contains(&root) {
            roots.push(root);
        }
    }

    for root in roots {
        let file_path = root.join(relative);
        if !file_path.is_file() {
            continue;
        }
        let Ok(contents) = fs::read(&file_path) else {
            continue;
        };
        let length = contents.len();
        if request.method() == tauri::http::Method::HEAD {
            return common_headers(Response::builder().status(StatusCode::OK))
                .header("Content-Type", mime_for(&file_path))
                .header("Content-Length", length.to_string())
                .body(Vec::new())
                .unwrap();
        }
        return common_headers(Response::builder().status(StatusCode::OK))
            .header("Content-Type", mime_for(&file_path))
            .header("Content-Length", length.to_string())
            .body(contents)
            .unwrap();
    }

    not_found()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detects_model_folders() {
        let root = std::env::temp_dir().join(format!("librecut-models-{}", uuid::Uuid::new_v4()));
        let model = root.join("Xenova").join("whisper-small");
        fs::create_dir_all(&model).unwrap();
        fs::write(model.join("config.json"), "{}").unwrap();
        fs::create_dir_all(root.join("empty")).unwrap();

        expect_models(&root, vec!["Xenova/whisper-small".to_string()]);
        fs::remove_dir_all(&root).ok();
    }

    fn expect_models(root: &Path, expected: Vec<String>) {
        assert_eq!(scan(root), expected);
    }
}
