mod encoder;
mod filters;
mod graph;
mod model;
mod render;
mod transitions;

use std::sync::atomic::{AtomicBool, Ordering};

use tauri::{AppHandle, Emitter, Manager, State};

pub use graph::build_graph;
pub use model::{
    ExportChromaKey, ExportClip, ExportCompressor, ExportDuckSegment, ExportEffect, ExportKeyframe,
    ExportLut, ExportMaskPoint, ExportProgress, ExportRequest, ExportResult, ExportSpeedPoint,
    ExportText, ExportTransition,
};
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
