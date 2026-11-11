use std::path::PathBuf;

use crate::ffmpeg;

#[tauri::command]
pub fn save_project(path: String, contents: String) -> Result<(), String> {
    serde_json::from_str::<serde_json::Value>(&contents)
        .map_err(|error| format!("Refusing to save invalid project data: {error}"))?;

    let target = PathBuf::from(path);
    ffmpeg::ensure_parent(&target)?;

    if target.is_file() {
        let backup = target.with_extension("librecut.bak");
        let _ = std::fs::copy(&target, backup);
    }

    let temp = target.with_extension("librecut.tmp");
    std::fs::write(&temp, contents).map_err(|error| format!("Could not write project: {error}"))?;
    if target.is_file() {
        std::fs::remove_file(&target)
            .map_err(|error| format!("Could not replace project: {error}"))?;
    }
    std::fs::rename(&temp, &target)
        .map_err(|error| format!("Could not finalize project: {error}"))?;
    Ok(())
}

#[tauri::command]
pub fn load_project(path: String) -> Result<String, String> {
    let target = PathBuf::from(path);
    let contents = std::fs::read_to_string(&target)
        .map_err(|error| format!("Could not read project: {error}"))?;
    serde_json::from_str::<serde_json::Value>(&contents)
        .map_err(|error| format!("Invalid project file: {error}"))?;
    Ok(contents)
}

#[tauri::command]
pub async fn has_nvenc() -> bool {
    let output = ffmpeg::command(&ffmpeg::ffmpeg_bin())
        .args(["-hide_banner", "-encoders"])
        .output()
        .await;
    match output {
        Ok(result) => {
            let text = String::from_utf8_lossy(&result.stdout);
            result.status.success() && text.contains("h264_nvenc")
        }
        Err(_) => false,
    }
}
