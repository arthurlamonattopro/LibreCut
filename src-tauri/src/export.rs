mod encoder;
mod filters;
mod graph;
mod model;
mod preview;
/// Public so the integration tests can exercise the cached render directly.
pub mod preview_render;
mod render;
mod transitions;

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State};

use crate::media::MediaRegistry;

pub use graph::build_graph;
pub use model::{
    ExportChromaKey, ExportClip, ExportCompressor, ExportDuckSegment, ExportEffect, ExportKeyframe,
    ExportLut, ExportMaskPoint, ExportProgress, ExportRequest, ExportResult, ExportSpeedPoint,
    ExportText, ExportTransition,
};
pub use preview::{render_frame, PreviewFrame};
pub use render::render_with_progress;
pub use transitions::XFADE_TRANSITIONS;

#[derive(Default)]
pub struct ExportState {
    cancel: AtomicBool,
    running: AtomicBool,
}

async fn run_export(
    app: AppHandle,
    state: &ExportState,
    request: ExportRequest,
) -> Result<ExportResult, String> {
    let cache = app
        .path()
        .app_cache_dir()
        .unwrap_or_else(|_| std::env::temp_dir().join("librecut"));
    render_with_progress(&request, &cache, &state.cancel, &|progress| {
        let _ = app.emit("export-progress", progress);
    })
    .await
}

#[tauri::command]
pub async fn export_project(
    app: AppHandle,
    state: State<'_, ExportState>,
    request: ExportRequest,
) -> Result<ExportResult, String> {
    if state.running.swap(true, Ordering::SeqCst) {
        return Err("An export is already running.".to_string());
    }
    state.cancel.store(false, Ordering::SeqCst);
    let result = run_export(app, &state, request).await;
    state.running.store(false, Ordering::SeqCst);
    result
}

#[tauri::command]
pub fn cancel_export(state: State<'_, ExportState>) {
    state.cancel.store(true, Ordering::SeqCst);
}

#[tauri::command]
pub fn is_exporting(state: State<'_, ExportState>) -> bool {
    state.running.load(Ordering::SeqCst)
}

/// A single frame rendered through the export filter graph.
#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct PreviewFrameResult {
    /// Media-registry id for the PNG, served over the regular media protocol.
    pub media_id: String,
    pub width: u32,
    pub height: u32,
    pub time: f64,
    pub elapsed_ms: u128,
}

/// Renders the frame at `time` with the same FFmpeg graph the export uses.
///
/// The renderer keeps the export and the preview from drifting apart: the
/// result includes the exact scaling, colour processing, font rasterisation,
/// and `xfade` transition the finished file will contain.
#[tauri::command]
pub async fn render_preview_frame(
    app: AppHandle,
    registry: State<'_, MediaRegistry>,
    request: ExportRequest,
    time: f64,
) -> Result<PreviewFrameResult, String> {
    let started = std::time::Instant::now();
    let cache = app
        .path()
        .app_cache_dir()
        .unwrap_or_else(|_| std::env::temp_dir().join("librecut"))
        .join("previews");
    let frame = preview::render_frame(&request, time, &cache).await?;

    std::fs::create_dir_all(&cache)
        .map_err(|error| format!("Could not prepare the preview cache: {error}"))?;
    cleanup_preview_files(&cache);
    let path = crate::ffmpeg::unique_file(&cache, "png");
    std::fs::write(&path, &frame.png)
        .map_err(|error| format!("Could not save the preview frame: {error}"))?;
    let media_id = registry.insert(path);
    Ok(PreviewFrameResult {
        media_id,
        width: frame.width,
        height: frame.height,
        time: frame.time,
        elapsed_ms: started.elapsed().as_millis(),
    })
}

/// An export-accurate playback file render session.
///
/// A single accurate preview render runs at a time; progress is emitted as
/// `preview-render-progress` so the stage can show it. The registry ids are
/// remembered together with the content key so an unchanged project reuses
/// the same media id instead of re-registering on every open.
#[derive(Default)]
pub struct PreviewRenderState {
    cancel: AtomicBool,
    running: AtomicBool,
    ids: Mutex<HashMap<String, String>>,
}

/// A render the preview subscribed to.
#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct PreviewPlaybackResult {
    /// Media-registry id for the rendered file.
    pub media_id: String,
    /// Stable content key of the rendered project.
    pub key: String,
    /// True when the cached file was reused without rendering anything.
    pub reused: bool,
    pub elapsed_ms: u128,
}

/// Drops registry ids whose files disappeared from the cache.
fn prune_ids(state: &PreviewRenderState, cache: &std::path::Path) {
    let mut ids = state
        .ids
        .lock()
        .unwrap_or_else(|poison| poison.into_inner());
    if let Ok(entries) = std::fs::read_dir(cache) {
        let alive: Vec<String> = entries
            .filter_map(Result::ok)
            .filter_map(|entry| {
                let name = entry.file_name();
                let name = name.to_string_lossy();
                name.strip_prefix("preview-")
                    .and_then(|rest| rest.strip_suffix(".mp4"))
                    .map(str::to_string)
            })
            .collect();
        ids.retain(|key, _| alive.contains(key));
    }
}

/// Renders the video an "export-accurate" playback quality mode shows.
///
/// The file is produced by the export graph, so every frame and every sample
/// coming out of it is what the export produces. A cached file for an
/// unchanged project is reused.
#[tauri::command]
pub async fn render_preview_playback(
    app: AppHandle,
    state: State<'_, PreviewRenderState>,
    registry: State<'_, MediaRegistry>,
    request: ExportRequest,
) -> Result<PreviewPlaybackResult, String> {
    if state.running.swap(true, Ordering::SeqCst) {
        return Err("An accurate preview is already rendering.".to_string());
    }
    state.cancel.store(false, Ordering::SeqCst);
    let started = std::time::Instant::now();
    let cache = app
        .path()
        .app_cache_dir()
        .unwrap_or_else(|_| std::env::temp_dir().join("librecut"))
        .join(preview_render::PREVIEW_DIR);
    let key = preview_render::preview_key(&request);
    let result = preview_render::render_preview(&request, &cache, &state.cancel, &|progress| {
        let _ = app.emit("preview-render-progress", progress);
    })
    .await;
    state.running.store(false, Ordering::SeqCst);
    prune_ids(&state, &cache);
    let (path, reused) = result?;
    let media_id = {
        let mut ids = state
            .ids
            .lock()
            .unwrap_or_else(|poison| poison.into_inner());
        match ids.get(&key) {
            Some(id) => id.clone(),
            None => {
                let id = registry.insert(path);
                ids.insert(key.clone(), id.clone());
                id
            }
        }
    };
    Ok(PreviewPlaybackResult {
        media_id,
        key,
        reused,
        elapsed_ms: started.elapsed().as_millis(),
    })
}

/// Stops the accurate preview render in progress.
#[tauri::command]
pub fn cancel_preview_render(state: State<'_, PreviewRenderState>) {
    state.cancel.store(true, Ordering::SeqCst);
}

/// Keeps the preview cache from growing for the life of the session.
fn cleanup_preview_files(dir: &std::path::Path) {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    let mut pngs: Vec<std::path::PathBuf> = entries
        .filter_map(Result::ok)
        .map(|entry| entry.path())
        .filter(|path| path.extension().and_then(|value| value.to_str()) == Some("png"))
        .collect();
    pngs.sort();
    let keep = 4usize;
    for path in pngs.iter().rev().skip(keep) {
        let _ = std::fs::remove_file(path);
    }
}
