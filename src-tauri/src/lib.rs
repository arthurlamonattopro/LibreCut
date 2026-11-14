pub mod export;
pub mod ffmpeg;
pub mod library;
pub mod media;
pub mod metrics;
pub mod models;
pub mod project;

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(media::MediaRegistry::default())
        .manage(export::ExportState::default())
        .manage(export::PreviewRenderState::default())
        .manage(metrics::MemoryTracker::default())
        .register_uri_scheme_protocol("librecut", |ctx, request| {
            media::handle_protocol(ctx.app_handle(), &request)
        })
        .register_uri_scheme_protocol("librecutmodel", |ctx, request| {
            models::handle_protocol(ctx.app_handle(), &request)
        })
        .invoke_handler(tauri::generate_handler![
            ffmpeg::runtime_status,
            media::register_media,
            media::generate_thumbnails,
            media::generate_waveform,
            media::create_proxy,
            media::remove_proxy_cache,
            media::read_media_for_ai,
            media::save_ai_audio,
            media::save_ai_image,
            export::export_project,
            export::cancel_export,
            export::is_exporting,
            export::render_preview_frame,
            export::render_preview_playback,
            export::cancel_preview_render,
            project::save_project,
            project::load_project,
            project::has_nvenc,
            library::save_project_document,
            library::load_project_document,
            library::load_project_cache,
            library::list_project_states,
            library::delete_project_state,
            library::clear_project_states,
            library::write_diagnostics_report,
            metrics::runtime_memory,
            models::offline_model_status,
            models::ensure_models_dir,
        ])
        .run(tauri::generate_context!())
        .expect("error while running LibreCut");
}
