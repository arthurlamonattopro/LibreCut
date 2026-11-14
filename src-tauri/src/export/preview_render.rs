//! An export-accurate playback file.
//!
//! Playing an edit through FFmpeg's own graph means every frame is produced by
//! the renderer that "Match export" uses, so the preview is the export rather
//! than a second approximation of it. The trade-off is render time: the file
//! is prepared on demand and cached by content, so unchanged projects play
//! instantly and edits trigger a re-render.
//!
//! The file is deliberately the export graph, not a transcode of it: pausing,
//! scrubbing, and seeking all show the very frames the export produces.

use std::hash::{Hash, Hasher};
use std::path::{Path, PathBuf};
use std::sync::atomic::AtomicBool;

use super::model::ExportRequest;
use super::render::render_with_progress;

/// Subdirectory of the cache that holds rendered previews.
pub const PREVIEW_DIR: &str = "preview-render";

const KEEP_RENDERS: usize = 2;

/// Hash of the render-relevant parts of an export request.
///
/// The output path is ignored, so rendering the same project twice into
/// different files produces the same key. Everything that changes the pixels
/// changes the key, including otherwise invisible settings such as the
/// resolution and the frame rate.
pub fn preview_key(request: &ExportRequest) -> String {
    let mut hashable = request.clone();
    hashable.output = String::new();
    // `Debug` prints the whole request deterministically, which is all the
    // cache needs from a key: same input, same key, different picture,
    // different key.
    let serialized = format!("{hashable:?}");
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    serialized.hash(&mut hasher);
    format!("{:016x}", hasher.finish())
}

/// The rendered file for a project, or the path it would have.
pub fn preview_path(cache_dir: &Path, key: &str) -> PathBuf {
    cache_dir.join(format!("preview-{key}.mp4"))
}

/// Finishes writing the render and deletes stale files.
///
/// Call after every render (or attempted render); it keeps the two most
/// recent previews so undo and small edits stay cheap, and discards partial
/// files left by interrupted runs. `protect` names the file the current
/// request needs, which is never deleted even if it is old.
pub fn cleanup_cache(cache_dir: &Path, protect: &Path) -> Vec<String> {
    let Ok(entries) = std::fs::read_dir(cache_dir) else {
        return Vec::new();
    };
    let mut previews: Vec<PathBuf> = entries
        .filter_map(Result::ok)
        .map(|entry| entry.path())
        .filter(|path| {
            path.extension().and_then(|ext| ext.to_str()) == Some("mp4")
                && path
                    .file_stem()
                    .and_then(|stem| stem.to_str())
                    .map(|stem| stem.starts_with("preview-") && !stem.contains(".partial"))
                    .unwrap_or(false)
        })
        .collect();
    previews.retain(|path| path != protect);
    previews.sort_by_cached_key(|path| {
        std::fs::metadata(path)
            .and_then(|meta| meta.modified())
            .ok()
            .and_then(|modified| modified.duration_since(std::time::UNIX_EPOCH).ok())
            .unwrap_or(std::time::Duration::ZERO)
    });
    let keep = previews.len().saturating_sub(KEEP_RENDERS);
    for path in previews.into_iter().take(keep) {
        let _ = std::fs::remove_file(path);
    }
    // Partial files are worthless: a fresh render overwrites them.
    let Ok(entries) = std::fs::read_dir(cache_dir) else {
        return Vec::new();
    };
    for entry in entries.filter_map(Result::ok) {
        let name = entry.file_name();
        let name = name.to_string_lossy();
        if name.contains(".partial") && (name.starts_with(".preview-") || name.starts_with("preview-")) {
            let _ = std::fs::remove_file(entry.path());
        }
    }
    // The keys of the previews left on disk.
    std::fs::read_dir(cache_dir)
        .map(|entries| {
            entries
                .filter_map(Result::ok)
                .filter_map(|entry| {
                    let name = entry.file_name();
                    let name = name.to_string_lossy();
                    name.strip_prefix("preview-")
                        .and_then(|rest| rest.strip_suffix(".mp4"))
                        .map(str::to_string)
                })
                .collect()
        })
        .unwrap_or_default()
}

/// Renders the preview for a project, reusing the cached file when the
/// project has not changed.
///
/// Returns the file's path and whether it was already present.
pub async fn render_preview(
    request: &ExportRequest,
    cache_dir: &Path,
    cancel: &AtomicBool,
    on_progress: &(dyn Fn(super::model::ExportProgress) + Send + Sync),
) -> Result<(PathBuf, bool), String> {
    std::fs::create_dir_all(cache_dir)
        .map_err(|error| format!("Could not prepare the preview cache: {error}"))?;
    let key = preview_key(request);
    let target = preview_path(cache_dir, &key);
    cleanup_cache(cache_dir, &target);
    if target.is_file()
        && target
            .metadata()
            .map(|meta| meta.len() > 512)
            .unwrap_or(false)
    {
        return Ok((target, true));
    }

    let mut render_request = request.clone();
    render_request.output = target.to_string_lossy().to_string();
    // The encode is not part of what the user judges, so render as fast as
    // the hardware allows. Every pixel is still produced by the export
    // graphs, filters, and decoders.
    render_request.encoder = Some("libx264".to_string());
    render_request.quality = Some("draft".to_string());
    render_with_progress(&render_request, cache_dir, cancel, on_progress).await?;
    Ok((target, false))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::export::{
        ExportClip, ExportKeyframe, ExportTransition,
    };

    fn clip(start: f64, duration: f64) -> ExportClip {
        ExportClip {
            path: "a.mp4".to_string(),
            track_id: Some("track".to_string()),
            start,
            duration,
            trim_in: 0.0,
            speed: 1.0,
            speed_ramp: Vec::new(),
            volume: 1.0,
            opacity: 1.0,
            has_audio: false,
            has_video: true,
            is_image: false,
            fit: Some("contain".to_string()),
            x: 0.0,
            y: 0.0,
            scale: 1.0,
            rotation: 0.0,
            mask: Some("none".to_string()),
            mask_x: 0.5,
            mask_y: 0.5,
            mask_width: 0.6,
            mask_height: 0.6,
            mask_rotation: 0.0,
            mask_points: Vec::new(),
            chroma_key: None,
            fade_in: 0.0,
            fade_out: 0.0,
            pitch: 0.0,
            bass: 0.0,
            treble: 0.0,
            mid: 0.0,
            bass_frequency: 180.0,
            mid_frequency: 1000.0,
            mid_width: 1.0,
            treble_frequency: 4000.0,
            pan: 0.0,
            compressor: None,
            duck_segments: Vec::new(),
            keyframes: vec![ExportKeyframe {
                property: "scale".to_string(),
                time: 0.0,
                value: 0.9,
            }],
            transition_in: ExportTransition::default(),
            transition_out: ExportTransition::default(),
        }
    }

    fn request(clips: Vec<ExportClip>) -> ExportRequest {
        ExportRequest {
            output: "out.mp4".to_string(),
            width: 1920,
            height: 1080,
            fps: 30.0,
            duration: 4.0,
            clips,
            texts: Vec::new(),
            effects: Vec::new(),
            encoder: None,
            quality: None,
            audio_codec: None,
            audio_bitrate: None,
            audio_sample_rate: None,
        }
    }

    #[test]
    fn the_key_ignores_the_output_path() {
        let mut first = request(vec![clip(0.0, 4.0)]);
        first.output = "one.mp4".to_string();
        let mut second = request(vec![clip(0.0, 4.0)]);
        second.output = "two.mp4".to_string();
        assert_eq!(preview_key(&first), preview_key(&second));
    }

    #[test]
    fn the_key_changes_with_the_picture() {
        let first = request(vec![clip(0.0, 4.0)]);
        let mut second = request(vec![clip(0.0, 4.0)]);
        second.fps = 24.0;
        assert_ne!(preview_key(&first), preview_key(&second));

        let mut third = request(vec![clip(0.0, 4.0)]);
        third.clips[0].trim_in = 1.0;
        assert_ne!(preview_key(&first), preview_key(&third));
    }
}
