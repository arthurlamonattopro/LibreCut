//! Checks the export-accurate playback cache: a render is reused while the
//! project is unchanged and replaced when the project changes.
//!
//! The frame contents are not asserted here; `preview_frame.rs` already
//! verifies that the graph produces the export's pixels. This test only
//! checks the lifecycle of the cached file.

use std::path::{Path, PathBuf};
use std::sync::atomic::AtomicBool;

use librecut_lib::export::{preview_render::render_preview, ExportClip, ExportRequest};
use librecut_lib::ffmpeg;

struct TempDir(PathBuf);

impl TempDir {
    fn new(label: &str) -> Self {
        let dir = std::env::temp_dir().join(format!(
            "librecut-preview-render-{label}-{}",
            uuid::Uuid::new_v4().simple()
        ));
        std::fs::create_dir_all(&dir).expect("create temp dir");
        Self(dir)
    }

    fn path(&self) -> &Path {
        &self.0
    }
}

impl Drop for TempDir {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

async fn ffmpeg_ready() -> bool {
    ffmpeg::command(&ffmpeg::ffmpeg_bin())
        .arg("-version")
        .output()
        .await
        .map(|output| output.status.success())
        .unwrap_or(false)
}

fn clip(path: &Path, start: f64, duration: f64) -> ExportClip {
    ExportClip {
        path: path.to_string_lossy().to_string(),
        track_id: Some("video-1".to_string()),
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
        keyframes: Vec::new(),
        transition_in: librecut_lib::export::ExportTransition::default(),
        transition_out: librecut_lib::export::ExportTransition::default(),
    }
}

fn request(clips: Vec<ExportClip>, duration: f64) -> ExportRequest {
    ExportRequest {
        output: String::new(),
        width: 320,
        height: 240,
        fps: 30.0,
        duration,
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

async fn make_video(dir: &Path) -> PathBuf {
    let output_path = dir.join("source.mp4");
    let output = ffmpeg::command(&ffmpeg::ffmpeg_bin())
        .args([
            "-v", "error", "-y", "-f", "lavfi", "-i",
            "testsrc2=size=320x240:rate=30", "-t", "2", "-c:v", "libx264", "-preset",
            "ultrafast", "-pix_fmt", "yuv420p",
        ])
        .arg(&output_path)
        .output()
        .await
        .expect("run ffmpeg");
    assert!(
        output.status.success(),
        "could not generate source media: {}",
        String::from_utf8_lossy(&output.stderr)
    );
    output_path
}

#[tokio::test]
async fn the_render_is_cached_until_the_project_changes() {
    if !ffmpeg_ready().await {
        eprintln!("Skipping preview render test: ffmpeg was not found.");
        return;
    }
    let temp = TempDir::new("cache");
    let source = make_video(temp.path()).await;
    let cancel = AtomicBool::new(false);
    let original = request(vec![clip(&source, 0.0, 1.0)], 1.0);

    let (first_path, reused) = render_preview(&original, temp.path(), &cancel, &|_progress| {})
        .await
        .expect("render the preview");
    assert!(!reused, "the first render must do the work");
    assert!(first_path.is_file());
    let size = std::fs::metadata(&first_path).expect("stat the render").len();
    assert!(size > 512, "the rendered file should not be empty");

    let (second_path, reused) = render_preview(&original, temp.path(), &cancel, &|_progress| {})
        .await
        .expect("render the preview again");
    assert!(reused, "an unchanged project must reuse the cached file");
    assert_eq!(first_path, second_path);
    assert_eq!(
        std::fs::metadata(&second_path).expect("stat the cached render").len(),
        size,
        "a reused file must not be re-written"
    );

    let mut changed = request(vec![clip(&source, 0.0, 1.0)], 1.0);
    changed.clips[0].trim_in = 0.5;
    let (third_path, reused) = render_preview(&changed, temp.path(), &cancel, &|_progress| {})
        .await
        .expect("render the preview for a changed project");
    assert!(!reused, "a changed project must render again");
    assert_ne!(third_path, first_path, "a changed project must get a new file");
    assert!(third_path.is_file());
}
