mod export;
mod ffmpeg;
mod media;
mod project;

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .manage(media::MediaRegistry::default())
        .manage(export::ExportState::default())
        .register_uri_scheme_protocol("librecut", |ctx, request| {
            media::handle_protocol(ctx.app_handle(), &request)
        })
        .invoke_handler(tauri::generate_handler![
            media::register_media,
            media::generate_thumbnails,
            media::generate_waveform,
            media::create_proxy,
            media::read_media_for_ai,
            media::save_ai_audio,
            media::save_ai_image,
            export::export_project,
            export::cancel_export,
            export::is_exporting,
            project::save_project,
            project::load_project,
            project::has_nvenc,
        ])
        .run(tauri::generate_context!())
        .expect("error while running LibreCut");
}
